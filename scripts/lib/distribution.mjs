import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";

const ROOT_FILES = [
  "SKILL.md",
  "README.md",
  "INSTALL.md",
  "LICENSE",
  "CHANGELOG.md",
  "SECURITY.md",
  "package.json",
];
const RUNTIME_DIRS = ["references", "scripts", "overrides", "tests/evals"];
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
const FIXED_ZIP_DATE = 33; // 1980-01-01
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
  if (!TEXT_EXTENSIONS.has(extension(path)) && basename(path) !== "LICENSE") {
    return buffer;
  }
  return Buffer.from(buffer.toString("utf8").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n"), "utf8");
}

function walkFiles(root, start, output) {
  const absolute = join(root, start);
  if (!existsSync(absolute)) return;
  const info = lstatSync(absolute);
  if (info.isSymbolicLink()) {
    throw new Error(`runtime payload cannot contain a symlink: ${start}`);
  }
  if (info.isFile()) {
    output.push(toPosix(start));
    return;
  }
  for (const entry of readdirSync(absolute).sort()) {
    walkFiles(root, join(start, entry), output);
  }
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
  return `---\n${frontmatter}\nlicense: MIT\ncompatibility: Requires Node.js 20+, git, GitHub network access, and an authenticated gh or brokered connector for writes.\nmetadata:\n  author: Wibias\n  version: "${version}"\n  repository: "https://github.com/Wibias/shipping-github"\n---${body}`;
}

function runtimeReferences(markdown) {
  const found = new Set();
  const pattern = /(?:<shipping-github>\/)?((?:references|scripts|overrides|tests\/evals)\/[A-Za-z0-9_.@<>/-]+)/g;
  for (const match of markdown.matchAll(pattern)) {
    const cleaned = match[1].replace(/[),.;:`'"\]}]+$/g, "");
    if (!cleaned.includes("<") && !cleaned.includes("*")) found.add(cleaned);
  }
  return [...found].sort();
}

function validateReferences(payloads) {
  const available = new Set(payloads.keys());
  for (const [path, buffer] of payloads) {
    if (extension(path) !== ".md") continue;
    for (const reference of runtimeReferences(buffer.toString("utf8"))) {
      const bundled =
        available.has(reference) ||
        [...available].some((candidate) => candidate.startsWith(`${reference}/`));
      if (!bundled) {
        throw new Error(`missing runtime reference: ${reference} (from ${path})`);
      }
    }
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
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
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) {
      return { name, prefix };
    }
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
  const path = join(root, "package.json");
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (value.name !== "shipping-github") throw new Error("package name must be shipping-github");
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
    if (path === "SKILL.md") {
      content = Buffer.from(injectSkillMetadata(content.toString("utf8"), { version }), "utf8");
    }
    payloads.set(path, content);
  }
  validateReferences(payloads);
  const manifest = {
    schemaVersion: 1,
    kind: "shipping-github/distribution-manifest",
    name: "shipping-github",
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
  const unpacked = join(out, "shipping-github");
  writePayloadDirectory(unpacked, archivePayloads);
  writeFileSync(join(out, "manifest.json"), manifestBuffer);

  const entries = [...archivePayloads.entries()].map(([path, content]) => ({
    path: `shipping-github/${path}`,
    content,
    mode: path.startsWith("scripts/") ? 0o755 : 0o644,
  }));
  const zipName = `shipping-github-v${version}.zip`;
  const tarName = `shipping-github-v${version}.tar.gz`;
  const zip = zipArchive(entries);
  const tar = tarArchive(entries);
  writeFileSync(join(out, zipName), zip);
  writeFileSync(join(out, tarName), tar);
  const sums = [
    [sha256(manifestBuffer), "manifest.json"],
    [sha256(tar), tarName],
    [sha256(zip), zipName],
  ]
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
    const leftBuffer = readFileSync(join(first, ...path.split("/")));
    const rightBuffer = readFileSync(join(second, ...path.split("/")));
    if (!leftBuffer.equals(rightBuffer)) differences.push({ path, reason: "content" });
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
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function installedPackage(path) {
  const value = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
  if (value.name !== "shipping-github") throw new Error("target is not a shipping-github installation");
  semverParts(value.version);
  return value;
}

export function planInstallation({ source, target, allowDowngrade = false, force = false } = {}) {
  source = resolve(source);
  target = resolve(target);
  const sourcePackage = installedPackage(source);
  if (!existsSync(target)) {
    return { action: "install", allowed: true, source, target, sourceVersion: sourcePackage.version, targetVersion: null };
  }
  const info = lstatSync(target);
  if (info.isSymbolicLink()) {
    return { action: "replace-symlink", allowed: force, source, target, sourceVersion: sourcePackage.version, targetVersion: null };
  }
  if (!info.isDirectory()) {
    return { action: "conflict", allowed: false, source, target, sourceVersion: sourcePackage.version, targetVersion: null };
  }
  let targetPackage;
  try {
    targetPackage = installedPackage(target);
  } catch {
    return { action: "conflict", allowed: false, source, target, sourceVersion: sourcePackage.version, targetVersion: null };
  }
  const comparison = compareVersions(sourcePackage.version, targetPackage.version);
  if (comparison > 0) {
    return { action: "upgrade", allowed: true, source, target, sourceVersion: sourcePackage.version, targetVersion: targetPackage.version };
  }
  if (comparison < 0) {
    return { action: "downgrade", allowed: allowDowngrade, source, target, sourceVersion: sourcePackage.version, targetVersion: targetPackage.version };
  }
  return { action: "same-version", allowed: force, source, target, sourceVersion: sourcePackage.version, targetVersion: targetPackage.version };
}

export function applyInstallation({ source, target, backupRoot, allowDowngrade = false, force = false } = {}) {
  const plan = planInstallation({ source, target, allowDowngrade, force });
  if (!plan.allowed) throw new Error(`installation is not allowed: ${plan.action}`);
  let backupPath = null;
  if (existsSync(plan.target)) {
    const root = resolve(backupRoot || join(dirname(plan.target), ".shipping-github-backups"));
    mkdirSync(root, { recursive: true });
    const suffix = `${Date.now()}-${plan.targetVersion || "unknown"}`;
    backupPath = join(root, `shipping-github-${suffix}`);
    renameSync(plan.target, backupPath);
  }
  try {
    cpSync(plan.source, plan.target, { recursive: true, errorOnExist: true, force: false });
  } catch (error) {
    rmSync(plan.target, { recursive: true, force: true });
    if (backupPath && existsSync(backupPath)) renameSync(backupPath, plan.target);
    throw error;
  }
  return {
    schemaVersion: 1,
    kind: "shipping-github/install-receipt",
    action: plan.action,
    sourceVersion: plan.sourceVersion,
    previousVersion: plan.targetVersion,
    target: plan.target,
    backupPath,
  };
}

export function restoreBackup({ backup, target } = {}) {
  backup = resolve(backup);
  target = resolve(target);
  if (!existsSync(backup) || !statSync(backup).isDirectory()) throw new Error("backup directory does not exist");
  rmSync(target, { recursive: true, force: true });
  renameSync(backup, target);
  return { schemaVersion: 1, kind: "shipping-github/restore-receipt", backup, target };
}
