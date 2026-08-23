import { createHash } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  cpSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";

import { inspectLegacyManifestlessInstallation } from "./bootstrap-cli.mjs";
import { targetInstallLockPath, withExclusiveInstallLock } from "./install-lock.mjs";
import { assertPortablePathIdentity } from "./release-path-identity.mjs";

const ROOT_FILES = [
  "SKILL.md",
  "README.md",
  "INSTALL.md",
  "LICENSE",
  "CHANGELOG.md",
  "SECURITY.md",
  "package.json",
];
const RUNTIME_DIRS = [
  "references",
  "scripts",
  "overrides",
  "tests/evals",
  "authority-host/windows",
];
const TEXT_EXTENSIONS = new Set([
  ".md",
  ".mjs",
  ".js",
  ".json",
  ".jsonl",
  ".yml",
  ".yaml",
  ".txt",
]);
const FIXED_ZIP_DATE = 33;
const FIXED_ZIP_TIME = 0;

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function toPosix(path) {
  return path.split(sep).join("/");
}

function extension(path) {
  const name = basename(path);
  const index = name.lastIndexOf(".");
  return index === -1 ? "" : name.slice(index).toLowerCase();
}

function normalizePayload(path, buffer) {
  if (!TEXT_EXTENSIONS.has(extension(path)) && basename(path) !== "LICENSE") return buffer;
  return Buffer.from(buffer.toString("utf8").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n"), "utf8");
}

function walkFiles(root, start, output) {
  const absolute = join(root, start);
  if (!existsSync(absolute)) return;
  const info = lstatSync(absolute);
  if (info.isSymbolicLink()) throw new Error(`runtime payload cannot contain a symlink: ${start}`);
  if (info.isFile()) {
    output.push(toPosix(start));
    return;
  }
  for (const entry of readdirSync(absolute).sort()) walkFiles(root, join(start, entry), output);
}

export function collectRuntimeFiles(root) {
  const files = [];
  for (const path of ROOT_FILES) walkFiles(root, path, files);
  for (const path of RUNTIME_DIRS) walkFiles(root, path, files);
  return [...new Set(files)].sort();
}

function stripExistingDistributionMetadata(frontmatter) {
  const lines = frontmatter.split("\n");
  const output = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^(license|compatibility):/.test(line)) continue;
    if (line === "metadata:") {
      while (index + 1 < lines.length && /^\s+/.test(lines[index + 1])) index += 1;
      continue;
    }
    output.push(line);
  }
  return output.join("\n").replace(/\n+$/, "");
}

export function injectSkillMetadata(source, { version }) {
  if (!source.startsWith("---\n")) throw new Error("SKILL.md must start with YAML frontmatter");
  const end = source.indexOf("\n---", 4);
  if (end === -1) throw new Error("SKILL.md frontmatter is not closed");
  const frontmatter = stripExistingDistributionMetadata(source.slice(4, end));
  const body = source.slice(end + 4).replace(/^\n?/, "\n");
  return `---\n${frontmatter}\nlicense: MIT\ncompatibility: Requires Node.js 22, 24, or 26, git, GitHub network access, and an authenticated gh or brokered connector for writes.\nmetadata:\n  author: Wibias\n  version: "${version}"\n  repository: "https://github.com/Wibias/github-delivery"\n---${body}`;
}

function runtimeReferences(markdown) {
  const found = new Set();
  const pattern = /(?<![A-Za-z0-9_<>/-])(?:<github-delivery>\/)?((?:references|scripts|overrides|tests\/evals|authority-host)\/[A-Za-z0-9_.@<>/-]+)/g;
  for (const match of markdown.matchAll(pattern)) {
    const cleaned = match[1].replace(/[),.;:`'"\]}]+$/g, "").replace(/\/+$/, "");
    if (!cleaned.includes("<") && !cleaned.includes("*") && cleaned) found.add(cleaned);
  }
  return [...found].sort();
}

function validateReferences(payloads) {
  const available = new Set(payloads.keys());
  for (const [path, buffer] of payloads) {
    if (extension(path) !== ".md") continue;
    for (const reference of runtimeReferences(buffer.toString("utf8"))) {
      const bundled = available.has(reference) || [...available].some((candidate) => candidate.startsWith(`${reference}/`));
      if (!bundled) throw new Error(`missing runtime reference: ${reference} (from ${path})`);
    }
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipArchive(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path, "utf8");
    const data = entry.content;
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(FIXED_ZIP_TIME, 10);
    local.writeUInt16LE(FIXED_ZIP_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(FIXED_ZIP_TIME, 12);
    central.writeUInt16LE(FIXED_ZIP_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((entry.mode & 0xffff) << 16, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuffer, end]);
}

function writeTarOctal(header, offset, length, value) {
  const text = Math.max(0, value).toString(8).padStart(length - 1, "0") + "\0";
  header.write(text.slice(-length), offset, length, "ascii");
}

function splitTarPath(path) {
  if (Buffer.byteLength(path) <= 100) return { name: path, prefix: "" };
  const parts = path.split("/");
  for (let index = parts.length - 1; index > 0; index -= 1) {
    const prefix = parts.slice(0, index).join("/");
    const name = parts.slice(index).join("/");
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { name, prefix };
  }
  throw new Error(`tar path is too long: ${path}`);
}

function tarArchive(entries) {
  const chunks = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512, 0);
    const { name, prefix } = splitTarPath(entry.path);
    header.write(name, 0, 100, "utf8");
    writeTarOctal(header, 100, 8, entry.mode);
    writeTarOctal(header, 108, 8, 0);
    writeTarOctal(header, 116, 8, 0);
    writeTarOctal(header, 124, 12, entry.content.length);
    writeTarOctal(header, 136, 12, 0);
    header.fill(0x20, 148, 156);
    header.write("0", 156, 1, "ascii");
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    header.write("root", 265, 32, "ascii");
    header.write("root", 297, 32, "ascii");
    if (prefix) header.write(prefix, 345, 155, "utf8");
    let checksum = 0;
    for (const byte of header) checksum += byte;
    const checksumText = checksum.toString(8).padStart(6, "0");
    header.write(checksumText, 148, 6, "ascii");
    header[154] = 0;
    header[155] = 0x20;
    chunks.push(header, entry.content);
    const remainder = entry.content.length % 512;
    if (remainder) chunks.push(Buffer.alloc(512 - remainder));
  }
  chunks.push(Buffer.alloc(1024));
  const gzip = gzipSync(Buffer.concat(chunks), { level: 0, mtime: 0 });
  gzip.fill(0, 4, 8);
  gzip[9] = 255;
  return gzip;
}

function readPackage(root) {
  const value = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (value.name !== "github-delivery") throw new Error("package name must be github-delivery");
  if (!/^\d+\.\d+\.\d+$/.test(value.version || "")) throw new Error("package version must be semantic x.y.z");
  return value;
}

function resolveSourceCommit(root, explicit) {
  if (explicit) {
    if (!/^[0-9a-f]{40}$/i.test(explicit)) throw new Error("source commit must be a 40-character SHA");
    return explicit.toLowerCase();
  }
  const env = process.env.SOURCE_COMMIT || process.env.GITHUB_SHA;
  if (env && /^[0-9a-f]{40}$/i.test(env)) return env.toLowerCase();
  return "unknown";
}

function writePayloadDirectory(path, payloads) {
  for (const [relativePath, content] of payloads) {
    const destination = join(path, ...relativePath.split("/"));
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content, { mode: relativePath.startsWith("scripts/") ? 0o755 : 0o644 });
  }
}

export function buildDistribution({ root = process.cwd(), out = join(root, "dist"), sourceCommit } = {}) {
  root = resolve(root);
  out = resolve(out);
  const packageJson = readPackage(root);
  const version = packageJson.version;
  const payloads = new Map();
  for (const path of collectRuntimeFiles(root)) {
    let content = normalizePayload(path, readFileSync(join(root, ...path.split("/"))));
    if (path === "SKILL.md") content = Buffer.from(injectSkillMetadata(content.toString("utf8"), { version }), "utf8");
    payloads.set(path, content);
  }
  assertPortablePathIdentity([...payloads.keys()], { code: "release_path" });
  validateReferences(payloads);
  const manifest = {
    schemaVersion: 1,
    kind: "github-delivery/distribution-manifest",
    name: "github-delivery",
    version,
    sourceCommit: resolveSourceCommit(root, sourceCommit),
    files: [...payloads.entries()].map(([path, content]) => ({
      path,
      bytes: content.length,
      mode: path.startsWith("scripts/") ? "0755" : "0644",
      sha256: sha256(content),
    })),
  };
  const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8");
  const archivePayloads = new Map(payloads);
  archivePayloads.set("manifest.json", manifestBuffer);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const unpacked = join(out, "github-delivery");
  writePayloadDirectory(unpacked, archivePayloads);
  writeFileSync(join(out, "manifest.json"), manifestBuffer);
  const entries = [...archivePayloads.entries()].map(([path, content]) => ({
    path: `github-delivery/${path}`,
    content,
    mode: path.startsWith("scripts/") ? 0o755 : 0o644,
  }));
  const zipName = `github-delivery-v${version}.zip`;
  const tarName = `github-delivery-v${version}.tar.gz`;
  const zip = zipArchive(entries);
  const tar = tarArchive(entries);
  writeFileSync(join(out, zipName), zip);
  writeFileSync(join(out, tarName), tar);
  const sums = [[sha256(manifestBuffer), "manifest.json"], [sha256(tar), tarName], [sha256(zip), zipName]]
    .sort((left, right) => left[1].localeCompare(right[1]))
    .map(([digest, name]) => `${digest}  ${name}`)
    .join("\n") + "\n";
  writeFileSync(join(out, "SHA256SUMS"), sums);
  return { manifest, out, zipName, tarName };
}

function directoryFiles(root) {
  const output = [];
  function walk(path) {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(path, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else output.push(toPosix(relative(root, absolute)));
    }
  }
  walk(root);
  return output;
}

export function compareDirectories(first, second) {
  const left = directoryFiles(first);
  const right = directoryFiles(second);
  const all = [...new Set([...left, ...right])].sort();
  const differences = [];
  for (const path of all) {
    if (!left.includes(path) || !right.includes(path)) {
      differences.push({ path, reason: "missing" });
      continue;
    }
    const firstPath = join(first, ...path.split("/"));
    const secondPath = join(second, ...path.split("/"));
    const firstInfo = lstatSync(firstPath);
    const secondInfo = lstatSync(secondPath);
    if (firstInfo.isSymbolicLink() || secondInfo.isSymbolicLink()) {
      differences.push({ path, reason: "type" });
      continue;
    }
    if (!readFileSync(firstPath).equals(readFileSync(secondPath))) differences.push({ path, reason: "content" });
  }
  return differences;
}

function semverParts(value) {
  if (!/^\d+\.\d+\.\d+$/.test(value || "")) throw new Error(`invalid semantic version: ${value}`);
  return value.split(".").map(Number);
}

function compareVersions(left, right) {
  const a = semverParts(left);
  const b = semverParts(right);
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  return 0;
}

function installedPackage(path) {
  const value = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
  if (value.name !== "github-delivery") throw new Error("target is not a github-delivery installation");
  semverParts(value.version);
  return value;
}

export function planInstallation({
  source,
  target,
  allowDowngrade = false,
  force = false,
  legacyManifestlessMigration = false,
} = {}) {
  source = resolve(source);
  target = resolve(target);
  const sourcePackage = installedPackage(source);
  if (!existsSync(target)) return { action: "install", allowed: true, source, target, sourceVersion: sourcePackage.version, targetVersion: null };
  const info = lstatSync(target);
  if (info.isSymbolicLink()) return { action: "replace-symlink", allowed: force, source, target, sourceVersion: sourcePackage.version, targetVersion: null };
  if (!info.isDirectory()) return { action: "conflict", allowed: false, source, target, sourceVersion: sourcePackage.version, targetVersion: null };
  let targetPackage;
  try { targetPackage = installedPackage(target); } catch { return { action: "conflict", allowed: false, source, target, sourceVersion: sourcePackage.version, targetVersion: null }; }
  const comparison = compareVersions(sourcePackage.version, targetPackage.version);

  if (legacyManifestlessMigration) {
    const legacy = inspectLegacyManifestlessInstallation({ target });
    const sourceManaged = existsSync(join(source, "manifest.json"));
    if (!legacy || legacy.version !== targetPackage.version || !sourceManaged) {
      return { action: "conflict", allowed: false, source, target, sourceVersion: sourcePackage.version, targetVersion: targetPackage.version };
    }
    if (comparison < 0) {
      return { action: "downgrade", allowed: false, source, target, sourceVersion: sourcePackage.version, targetVersion: targetPackage.version };
    }
    return { action: "migrate-legacy", allowed: true, source, target, sourceVersion: sourcePackage.version, targetVersion: targetPackage.version };
  }

  if (comparison > 0) return { action: "upgrade", allowed: true, source, target, sourceVersion: sourcePackage.version, targetVersion: targetPackage.version };
  if (comparison < 0) return { action: "downgrade", allowed: allowDowngrade, source, target, sourceVersion: sourcePackage.version, targetVersion: targetPackage.version };
  const differences = compareDirectories(source, target);
  if (differences.length === 0) {
    return { action: "same-version", allowed: true, unchanged: true, source, target, sourceVersion: sourcePackage.version, targetVersion: targetPackage.version };
  }
  return { action: "same-version", allowed: false, unchanged: false, source, target, sourceVersion: sourcePackage.version, targetVersion: targetPackage.version, differences };
}

function siblingPath(target, prefix) {
  const directory = dirname(target);
  const name = basename(target);
  let attempt = 0;
  let candidate;
  do {
    candidate = join(directory, `${prefix}${name}-${process.pid}-${Date.now()}-${attempt}`);
    attempt += 1;
  } while (existsSync(candidate));
  return candidate;
}

function installJournalPath(target) {
  return join(dirname(target), `.github-delivery-install-journal-${basename(target)}`);
}

function previousInstallJournalPath(path) {
  return `${path}.prev`;
}

function writeInstallJournal(path, journal, { renameSync: rename = renameSync, unlinkSync: unlink = unlinkSync } = {}) {
  const tmp = `${path}.${process.pid}.tmp`;
  const previous = previousInstallJournalPath(path);
  const fd = openSync(tmp, "w");
  try {
    writeSync(fd, `${JSON.stringify(journal)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    rename(tmp, path);
    if (existsSync(previous)) unlink(previous);
    return;
  } catch {
    // dest exists (Windows rename-over) or another replace failure
  }
  if (!existsSync(path)) {
    try {
      rename(tmp, path);
      return;
    } catch (retryError) {
      if (existsSync(tmp)) unlink(tmp);
      throw retryError;
    }
  }
  if (existsSync(previous)) unlink(previous);
  try {
    rename(path, previous);
  } catch (asideError) {
    if (existsSync(tmp)) unlink(tmp);
    throw asideError;
  }
  try {
    rename(tmp, path);
  } catch (retryError) {
    if (existsSync(path) && existsSync(tmp)) unlink(tmp);
    throw retryError;
  }
  if (existsSync(previous)) unlink(previous);
}

function readInstallJournal(path) {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || parsed.kind !== "github-delivery/install-journal") return null;
    return parsed;
  } catch {
    return null;
  }
}

function readDurableInstallJournal(journalPath) {
  const live = readInstallJournal(journalPath);
  if (live) return live;
  const directory = dirname(journalPath);
  const prefix = `${basename(journalPath)}.`;
  try {
    for (const entry of readdirSync(directory)) {
      if (!entry.startsWith(prefix) || !entry.endsWith(".tmp")) continue;
      const parsed = readInstallJournal(join(directory, entry));
      if (parsed) return parsed;
    }
  } catch {
    // missing directory
  }
  return readInstallJournal(previousInstallJournalPath(journalPath));
}

function clearInstallJournal(journalPath, unlink = unlinkSync) {
  const directory = dirname(journalPath);
  const base = basename(journalPath);
  const candidates = [journalPath, previousInstallJournalPath(journalPath)];
  try {
    for (const entry of readdirSync(directory)) {
      if (entry.startsWith(`${base}.`) && entry.endsWith(".tmp")) {
        candidates.push(join(directory, entry));
      }
    }
  } catch {
    // missing directory
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) unlink(candidate);
  }
}

function collectInstallFileDigests(root) {
  const files = [];
  function walk(relative) {
    const absolute = relative ? join(root, ...relative.split("/")) : root;
    for (const entry of readdirSync(absolute, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      const childAbsolute = join(absolute, entry.name);
      if (lstatSync(childAbsolute).isSymbolicLink()) {
        throw new Error(`install source cannot contain a symlink: ${child}`);
      }
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) files.push({ path: child, sha256: sha256(readFileSync(childAbsolute)) });
    }
  }
  walk("");
  return files;
}

function stagingMatchesExpected(stagingPath, expectedFiles) {
  if (!Array.isArray(expectedFiles) || expectedFiles.length === 0) return false;
  let actual;
  try {
    actual = collectInstallFileDigests(stagingPath);
  } catch {
    return false;
  }
  if (actual.length !== expectedFiles.length) return false;
  const expected = new Map(expectedFiles.map((file) => [file.path, file.sha256]));
  for (const file of actual) {
    if (expected.get(file.path) !== file.sha256) return false;
  }
  return true;
}

function canPromoteStaging(journal, stagingPath) {
  if (!journal) return false;
  if (journal.phase !== "staged" && journal.phase !== "displacing" && journal.phase !== "displaced") return false;
  return stagingMatchesExpected(stagingPath, journal.expectedFiles);
}

function findSiblingWithPrefix(target, prefix) {
  const directory = dirname(target);
  const marker = `${prefix}${basename(target)}-`;
  let matches;
  try {
    matches = readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(marker))
      .map((entry) => join(directory, entry.name));
  } catch {
    return null;
  }
  if (matches.length !== 1) return null;
  return matches[0];
}

function resolveRecoveryPaths(target, journal) {
  const stagingFromJournal = journal?.stagingPath ? resolve(journal.stagingPath) : null;
  const backupFromJournal = journal?.backupPath ? resolve(journal.backupPath) : null;
  const asideFromJournal = journal?.asidePath ? resolve(journal.asidePath) : null;
  return {
    stagingPath: stagingFromJournal && existsSync(stagingFromJournal)
      ? stagingFromJournal
      : findSiblingWithPrefix(target, ".github-delivery-staging-"),
    backupPath: backupFromJournal && existsSync(backupFromJournal) ? backupFromJournal : null,
    asidePath: asideFromJournal && existsSync(asideFromJournal)
      ? asideFromJournal
      : findSiblingWithPrefix(target, ".github-delivery-restore-aside-"),
  };
}

export function recoverInterruptedInstallation(options = {}) {
  const target = resolve(options.target);
  return withExclusiveInstallLock(targetInstallLockPath(target), () => recoverInterruptedInstallationHeld(options));
}

function recoverInterruptedInstallationHeld({
  target,
  renameSync: rename = renameSync,
  rmSync: remove = rmSync,
} = {}) {
  target = resolve(target);
  const journalPath = installJournalPath(target);
  const journal = readDurableInstallJournal(journalPath);
  const { stagingPath, backupPath, asidePath } = resolveRecoveryPaths(target, journal);
  if (!journal && !stagingPath && !asidePath && !backupPath) return { recovered: false };

  if (!existsSync(target) && stagingPath && existsSync(stagingPath) && canPromoteStaging(journal, stagingPath)) {
    rename(stagingPath, target);
    clearInstallJournal(journalPath);
    return { recovered: true, action: "completed", backupPath };
  }
  if (!existsSync(target) && journal?.phase === "restoring" && backupPath && existsSync(backupPath)) {
    rename(backupPath, target);
    if (asidePath && existsSync(asidePath) && resolve(asidePath) !== target) {
      remove(asidePath, { recursive: true, force: true });
    }
    clearInstallJournal(journalPath);
    return { recovered: true, action: "completed", backupPath };
  }
  if (!existsSync(target) && asidePath && existsSync(asidePath)) {
    rename(asidePath, target);
    clearInstallJournal(journalPath);
    return { recovered: true, action: "rolled-back", backupPath };
  }
  if (!existsSync(target) && backupPath && existsSync(backupPath)) {
    rename(backupPath, target);
    if (stagingPath && existsSync(stagingPath)) remove(stagingPath, { recursive: true, force: true });
    clearInstallJournal(journalPath);
    return { recovered: true, action: "rolled-back", backupPath };
  }
  if (stagingPath && existsSync(stagingPath) && resolve(stagingPath) !== target) {
    remove(stagingPath, { recursive: true, force: true });
  }
  if (asidePath && existsSync(asidePath) && resolve(asidePath) !== target) {
    remove(asidePath, { recursive: true, force: true });
  }
  clearInstallJournal(journalPath);
  return { recovered: false };
}

export function applyInstallation(options = {}) {
  return withExclusiveInstallLock(targetInstallLockPath(options.target), () => applyInstallationHeld(options));
}

function applyInstallationHeld({
  source,
  target,
  backupRoot,
  allowDowngrade = false,
  force = false,
  legacyManifestlessMigration = false,
  copySync = cpSync,
  renameSync: rename = renameSync,
  rmSync: remove = rmSync,
  restoreOnFailure = true,
  afterDisplace,
} = {}) {
  recoverInterruptedInstallationHeld({ target, renameSync: rename, rmSync: remove });
  const plan = planInstallation({
    source,
    target,
    allowDowngrade,
    force,
    legacyManifestlessMigration,
  });
  if (!plan.allowed) throw new Error(`installation is not allowed: ${plan.action}`);
  if (plan.action === "same-version" && plan.unchanged === true) {
    return {
      schemaVersion: 1,
      kind: "github-delivery/install-receipt",
      action: plan.action,
      sourceVersion: plan.sourceVersion,
      previousVersion: plan.targetVersion,
      target: plan.target,
      backupPath: null,
      unchanged: true,
    };
  }
  mkdirSync(dirname(plan.target), { recursive: true });
  const stagingPath = siblingPath(plan.target, ".github-delivery-staging-");
  const journalPath = installJournalPath(plan.target);
  const expectedFiles = collectInstallFileDigests(plan.source);
  const journalState = (phase, backupPath = null) => ({
    schemaVersion: 1,
    kind: "github-delivery/install-journal",
    phase,
    target: plan.target,
    stagingPath,
    backupPath,
    expectedFiles,
  });
  const journalIo = { renameSync: rename, unlinkSync };
  writeInstallJournal(journalPath, journalState("staging"), journalIo);
  try {
    copySync(plan.source, stagingPath, { recursive: true, errorOnExist: true, force: false });
  } catch (error) {
    if (restoreOnFailure !== false) {
      if (existsSync(stagingPath)) remove(stagingPath, { recursive: true, force: true });
      clearInstallJournal(journalPath);
    }
    throw error;
  }
  if (!stagingMatchesExpected(stagingPath, expectedFiles)) {
    if (restoreOnFailure !== false) {
      if (existsSync(stagingPath)) remove(stagingPath, { recursive: true, force: true });
      clearInstallJournal(journalPath);
    }
    throw new Error("install_staging_incomplete");
  }
  writeInstallJournal(journalPath, journalState("staged"), journalIo);

  let backupPath = null;
  try {
    if (existsSync(plan.target)) {
      const root = resolve(backupRoot || join(dirname(plan.target), ".github-delivery-backups"));
      mkdirSync(root, { recursive: true });
      backupPath = join(root, `github-delivery-${Date.now()}-${plan.targetVersion || "unknown"}`);
      writeInstallJournal(journalPath, journalState("displacing", backupPath), journalIo);
      rename(plan.target, backupPath);
      writeInstallJournal(journalPath, journalState("displaced", backupPath), journalIo);
      if (typeof afterDisplace === "function") afterDisplace({ target: plan.target, backupPath, stagingPath });
    }
    if (!stagingMatchesExpected(stagingPath, expectedFiles)) {
      throw new Error("install_staging_incomplete");
    }
    rename(stagingPath, plan.target);
    clearInstallJournal(journalPath);
  } catch (error) {
    if (restoreOnFailure !== false) {
      recoverInterruptedInstallationHeld({ target: plan.target, renameSync: rename, rmSync: remove });
    }
    if (existsSync(stagingPath) && existsSync(plan.target)) {
      remove(stagingPath, { recursive: true, force: true });
    }
    throw error;
  }
  return { schemaVersion: 1, kind: "github-delivery/install-receipt", action: plan.action, sourceVersion: plan.sourceVersion, previousVersion: plan.targetVersion, target: plan.target, backupPath };
}

export function restoreBackup(options = {}) {
  return withExclusiveInstallLock(targetInstallLockPath(options.target), () => restoreBackupHeld(options));
}

function restoreBackupHeld({
  backup,
  target,
  renameSync: rename = renameSync,
  rmSync: remove = rmSync,
  restoreOnFailure = true,
} = {}) {
  backup = resolve(backup);
  target = resolve(target);
  recoverInterruptedInstallationHeld({ target, renameSync: rename, rmSync: remove });
  if (!existsSync(backup) || !statSync(backup).isDirectory()) throw new Error("backup directory does not exist");
  if (!existsSync(target)) {
    rename(backup, target);
    return { schemaVersion: 1, kind: "github-delivery/restore-receipt", backup, target };
  }
  const asidePath = siblingPath(target, ".github-delivery-restore-aside-");
  const journalPath = installJournalPath(target);
  try {
    writeInstallJournal(journalPath, {
      schemaVersion: 1,
      kind: "github-delivery/install-journal",
      phase: "restoring",
      target,
      stagingPath: null,
      backupPath: backup,
      asidePath,
    }, { renameSync: rename, unlinkSync });
    rename(target, asidePath);
    rename(backup, target);
    clearInstallJournal(journalPath);
  } catch (error) {
    if (restoreOnFailure !== false) {
      if (!existsSync(target) && existsSync(asidePath)) rename(asidePath, target);
      else recoverInterruptedInstallationHeld({ target, renameSync: rename, rmSync: remove });
      if (existsSync(target)) clearInstallJournal(journalPath);
    }
    throw error;
  }
  if (existsSync(asidePath)) remove(asidePath, { recursive: true, force: true });
  return { schemaVersion: 1, kind: "github-delivery/restore-receipt", backup, target };
}
