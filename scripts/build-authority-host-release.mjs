#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const FIXED_ZIP_DATE = 33;
const FIXED_ZIP_TIME = 0;
const ROOT = "GitHubDeliveryAuthority/";

function fail(code, detail = "") {
  throw new Error(detail ? `${code}:${detail}` : code);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toPosix(path) {
  return path.split(sep).join("/");
}

function validateVersion(version) {
  if (!/^\d+\.\d+\.\d+$/.test(String(version || ""))) fail("authority_host_release_version_invalid");
  return String(version);
}

function validateCommit(sourceCommit) {
  if (!/^[0-9a-f]{40}$/i.test(String(sourceCommit || ""))) fail("authority_host_release_source_commit_invalid");
  return String(sourceCommit).toLowerCase();
}

function walkRegularFiles(root, current, output) {
  const absolute = join(root, current);
  const info = lstatSync(absolute);
  if (info.isSymbolicLink()) fail("authority_host_release_symlink_forbidden", current);
  if (info.isFile()) {
    output.push(toPosix(current));
    return;
  }
  if (!info.isDirectory()) fail("authority_host_release_file_type_invalid", current);
  for (const entry of readdirSync(absolute).sort()) walkRegularFiles(root, join(current, entry), output);
}

function collectFiles(publishDir) {
  if (!existsSync(publishDir)) fail("authority_host_release_publish_dir_missing");
  const files = [];
  for (const entry of readdirSync(publishDir).sort()) walkRegularFiles(publishDir, entry, files);
  if (files.length === 0) fail("authority_host_release_publish_dir_empty");
  if (!files.includes("GitHubDeliveryAuthority.exe")) fail("authority_host_release_executable_missing");
  if (files.includes("authority-host-version.json")) fail("authority_host_release_reserved_file_present");
  return files;
}

function storedZip(entries) {
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
    central.writeUInt32LE((0o100644 & 0xffff) << 16, 38);
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

export function buildAuthorityHostRelease({ publishDir, outDir, version, sourceCommit } = {}) {
  publishDir = resolve(String(publishDir || ""));
  outDir = resolve(String(outDir || ""));
  version = validateVersion(version);
  sourceCommit = validateCommit(sourceCommit);
  const files = collectFiles(publishDir);

  const versionInfo = {
    schemaVersion: 1,
    kind: "github-delivery/authority-host-version",
    version,
    sourceCommit,
    platform: "win32",
    arch: "x64",
  };
  const versionBytes = Buffer.from(`${JSON.stringify(versionInfo, null, 2)}\n`, "utf8");
  const payload = files.map((path) => ({
    path,
    content: readFileSync(join(publishDir, ...path.split("/"))),
  }));
  payload.push({ path: "authority-host-version.json", content: versionBytes });
  payload.sort((left, right) => left.path.localeCompare(right.path));

  const entries = payload.map((entry) => ({
    path: `${ROOT}${entry.path}`,
    content: entry.content,
  }));
  const archive = storedZip(entries);
  const archiveName = `github-delivery-authority-v${version}-win-x64.zip`;
  const metadataName = `github-delivery-authority-v${version}-win-x64.json`;
  const metadata = {
    schemaVersion: 1,
    kind: "github-delivery/authority-host-release",
    version,
    sourceCommit,
    platform: "win32",
    arch: "x64",
    archive: archiveName,
    sha256: sha256(archive),
    files: payload.map((entry) => ({
      path: entry.path,
      bytes: entry.content.length,
      sha256: sha256(entry.content),
    })),
  };

  mkdirSync(outDir, { recursive: true });
  const archivePath = join(outDir, archiveName);
  const metadataPath = join(outDir, metadataName);
  writeFileSync(archivePath, archive);
  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  return { archivePath, metadataPath, metadata };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--publish-dir") options.publishDir = argv[++index];
    else if (arg === "--out-dir") options.outDir = argv[++index];
    else if (arg === "--version") options.version = argv[++index];
    else if (arg === "--source-commit") options.sourceCommit = argv[++index];
    else fail("authority_host_release_argument_unknown", arg);
  }
  if (!options.publishDir || !options.outDir || !options.version || !options.sourceCommit) {
    fail("authority_host_release_arguments_required");
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = buildAuthorityHostRelease(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result.metadata, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: String(error?.message || error) })}\n`);
    process.exitCode = 1;
  }
}
