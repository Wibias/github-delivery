import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { TextDecoder } from "node:util";

const DEFAULT_LIMITS = Object.freeze({
  maxArchiveBytes: 32 * 1024 * 1024,
  maxFileBytes: 16 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxFiles: 4096,
});
const ROOT = "github-delivery/";
const UTF8_FLAG = 0x0800;
const ENCRYPTED_FLAG = 0x0001;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const STORED_METHOD = 0;
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const decoder = new TextDecoder("utf-8", { fatal: true });

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

function fail(code, detail = "") {
  throw new Error(detail ? `${code}:${detail}` : code);
}

function boundedUInt32(buffer, offset, code) {
  if (offset < 0 || offset + 4 > buffer.length) fail(code);
  return buffer.readUInt32LE(offset);
}

function validateEntryPath(path) {
  if (typeof path !== "string" || path.length === 0 || path.includes("\0")) fail("release_zip_path_invalid");
  if (path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) fail("release_zip_path_invalid", path);
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) fail("release_zip_path_invalid", path);
  if (!path.startsWith(ROOT) || path === ROOT.slice(0, -1)) fail("release_zip_path_invalid", path);
  const relativePath = path.slice(ROOT.length);
  if (!relativePath || relativePath.endsWith("/")) fail("release_zip_path_invalid", path);
  return relativePath;
}

function decodeName(buffer) {
  try { return decoder.decode(buffer); }
  catch { fail("release_zip_name_encoding_invalid"); }
}

function findEocd(buffer) {
  const minimum = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== EOCD_SIGNATURE) continue;
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength !== buffer.length) continue;
    return offset;
  }
  fail("release_zip_eocd_missing");
}

function normalizeLimits(limits = {}) {
  const value = { ...DEFAULT_LIMITS, ...limits };
  for (const [name, amount] of Object.entries(value)) {
    if (!Number.isSafeInteger(amount) || amount <= 0) fail("release_zip_limit_invalid", name);
  }
  return value;
}

function validateManifest(manifest) {
  if (
    manifest?.schemaVersion !== 1 ||
    manifest?.kind !== "github-delivery/distribution-manifest" ||
    manifest?.name !== "github-delivery" ||
    !Array.isArray(manifest.files)
  ) fail("release_zip_manifest_invalid");
  const files = new Map();
  for (const entry of manifest.files) {
    const path = entry?.path;
    if (typeof path !== "string" || !path || path.includes("\0") || path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
      fail("release_zip_manifest_path_invalid");
    }
    const segments = path.split("/");
    if (segments.some((segment) => !segment || segment === "." || segment === "..")) fail("release_zip_manifest_path_invalid", path);
    if (path === "manifest.json") fail("release_zip_manifest_invalid", "manifest.json_declared");
    if (files.has(path)) fail("release_zip_manifest_path_duplicate", path);
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0) fail("release_zip_manifest_invalid", path);
    if (!/^[0-9a-f]{64}$/.test(String(entry.sha256 || ""))) fail("release_zip_manifest_invalid", path);
    if (!/^(0644|0755)$/.test(String(entry.mode || ""))) fail("release_zip_manifest_invalid", path);
    files.set(path, entry);
  }
  return files;
}

export function inspectReleaseZip(archive, { limits = {} } = {}) {
  if (!Buffer.isBuffer(archive)) fail("release_zip_invalid");
  const bound = normalizeLimits(limits);
  if (archive.length > bound.maxArchiveBytes) fail("release_zip_archive_limit_exceeded");
  if (archive.length < 22) fail("release_zip_invalid");

  const eocd = findEocd(archive);
  const disk = archive.readUInt16LE(eocd + 4);
  const centralDisk = archive.readUInt16LE(eocd + 6);
  const entriesOnDisk = archive.readUInt16LE(eocd + 8);
  const entryCount = archive.readUInt16LE(eocd + 10);
  const centralSize = archive.readUInt32LE(eocd + 12);
  const centralOffset = archive.readUInt32LE(eocd + 16);
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) fail("release_zip_multidisk_unsupported");
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) fail("release_zip_zip64_unsupported");
  if (entryCount > bound.maxFiles) fail("release_zip_file_count_exceeded");
  if (centralOffset + centralSize !== eocd || centralOffset > archive.length) fail("release_zip_central_directory_invalid");

  const entries = [];
  const paths = new Set();
  let cursor = centralOffset;
  let totalBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > eocd || boundedUInt32(archive, cursor, "release_zip_central_directory_invalid") !== CENTRAL_SIGNATURE) {
      fail("release_zip_central_directory_invalid");
    }
    const versionMadeBy = archive.readUInt16LE(cursor + 4);
    const flags = archive.readUInt16LE(cursor + 8);
    const method = archive.readUInt16LE(cursor + 10);
    const checksum = archive.readUInt32LE(cursor + 16);
    const compressedBytes = archive.readUInt32LE(cursor + 20);
    const bytes = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const diskStart = archive.readUInt16LE(cursor + 34);
    const externalAttributes = archive.readUInt32LE(cursor + 38);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const end = cursor + 46 + nameLength + extraLength + commentLength;
    if (end > eocd) fail("release_zip_central_directory_invalid");
    if (diskStart !== 0) fail("release_zip_multidisk_unsupported");
    if ((flags & ENCRYPTED_FLAG) !== 0) fail("release_zip_encryption_unsupported");
    if ((flags & DATA_DESCRIPTOR_FLAG) !== 0) fail("release_zip_data_descriptor_unsupported");
    if ((flags & UTF8_FLAG) === 0) fail("release_zip_utf8_required");
    if (method !== STORED_METHOD) fail("release_zip_compression_unsupported");
    if (compressedBytes !== bytes) fail("release_zip_compression_unsupported");
    if (extraLength !== 0 || commentLength !== 0) fail("release_zip_extra_fields_unsupported");
    if (bytes > bound.maxFileBytes) fail("release_zip_file_limit_exceeded");
    totalBytes += bytes;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > bound.maxTotalBytes) fail("release_zip_total_limit_exceeded");

    const nameBytes = archive.subarray(cursor + 46, cursor + 46 + nameLength);
    const path = decodeName(nameBytes);
    const relativePath = validateEntryPath(path);
    if (paths.has(relativePath)) fail("release_zip_entry_duplicate", relativePath);
    paths.add(relativePath);

    const madeByOs = versionMadeBy >>> 8;
    const unixMode = madeByOs === 3 ? (externalAttributes >>> 16) & 0xffff : 0;
    const fileType = unixMode & 0o170000;
    if (fileType !== 0 && fileType !== 0o100000) fail("release_zip_file_type_unsupported", relativePath);

    if (localOffset + 30 > centralOffset || boundedUInt32(archive, localOffset, "release_zip_local_header_invalid") !== LOCAL_SIGNATURE) {
      fail("release_zip_local_header_invalid", relativePath);
    }
    const localFlags = archive.readUInt16LE(localOffset + 6);
    const localMethod = archive.readUInt16LE(localOffset + 8);
    const localChecksum = archive.readUInt32LE(localOffset + 14);
    const localCompressedBytes = archive.readUInt32LE(localOffset + 18);
    const localBytes = archive.readUInt32LE(localOffset + 22);
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    if (
      localFlags !== flags ||
      localMethod !== method ||
      localChecksum !== checksum ||
      localCompressedBytes !== compressedBytes ||
      localBytes !== bytes ||
      localExtraLength !== 0
    ) fail("release_zip_local_header_mismatch", relativePath);
    const localNameStart = localOffset + 30;
    const localNameEnd = localNameStart + localNameLength;
    if (localNameEnd > centralOffset || !archive.subarray(localNameStart, localNameEnd).equals(nameBytes)) {
      fail("release_zip_local_header_mismatch", relativePath);
    }
    const dataOffset = localNameEnd;
    const dataEnd = dataOffset + compressedBytes;
    if (dataEnd > centralOffset) fail("release_zip_entry_bounds_invalid", relativePath);
    const content = archive.subarray(dataOffset, dataEnd);
    if (crc32(content) !== checksum) fail("release_zip_crc_mismatch", relativePath);

    entries.push({
      path,
      relativePath,
      bytes,
      compressedBytes,
      mode: unixMode,
      crc32: checksum,
      dataOffset,
      dataEnd,
    });
    cursor = end;
  }
  if (cursor !== eocd) fail("release_zip_central_directory_invalid");
  return { entries, totalBytes };
}

function ensurePrivateDestination(destination) {
  destination = resolve(destination);
  if (existsSync(destination)) {
    if (lstatSync(destination).isSymbolicLink()) fail("release_zip_destination_unsafe");
  } else {
    mkdirSync(destination, { recursive: true, mode: 0o700 });
  }
  const root = join(destination, "github-delivery");
  if (existsSync(root)) fail("release_zip_destination_exists");
  return { destination, root };
}

export function extractVerifiedReleaseZip({ archive, manifest, manifestBytes = undefined, destination, limits = {} } = {}) {
  const expectedFiles = validateManifest(manifest);
  const expectedManifest = Buffer.isBuffer(manifestBytes)
    ? manifestBytes
    : Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8");
  const { entries } = inspectReleaseZip(archive, { limits });
  const byPath = new Map(entries.map((entry) => [entry.relativePath, entry]));

  for (const entry of entries) {
    if (entry.relativePath === "manifest.json") continue;
    if (!expectedFiles.has(entry.relativePath)) fail("release_zip_file_undeclared", entry.relativePath);
  }
  const archiveManifest = byPath.get("manifest.json");
  if (!archiveManifest) fail("release_zip_manifest_file_missing", "manifest.json");
  const archiveManifestBytes = archive.subarray(archiveManifest.dataOffset, archiveManifest.dataEnd);
  if (!archiveManifestBytes.equals(expectedManifest)) fail("release_zip_manifest_mismatch");

  for (const [path, expected] of expectedFiles) {
    const entry = byPath.get(path);
    if (!entry) fail("release_zip_manifest_file_missing", path);
    const content = archive.subarray(entry.dataOffset, entry.dataEnd);
    if (content.length !== expected.bytes || sha256(content) !== expected.sha256) fail("release_zip_manifest_file_mismatch", path);
    const expectedMode = Number.parseInt(expected.mode, 8);
    const archivePermission = entry.mode & 0o777;
    if (entry.mode !== 0 && archivePermission !== expectedMode) fail("release_zip_mode_mismatch", path);
  }

  const paths = ensurePrivateDestination(destination);
  mkdirSync(paths.root, { recursive: false, mode: 0o700 });
  for (const entry of entries) {
    const output = join(paths.root, ...entry.relativePath.split("/"));
    const segments = entry.relativePath.split("/");
    if (segments.length > 1) mkdirSync(join(paths.root, ...segments.slice(0, -1)), { recursive: true, mode: 0o700 });
    const content = archive.subarray(entry.dataOffset, entry.dataEnd);
    const expected = entry.relativePath === "manifest.json" ? null : expectedFiles.get(entry.relativePath);
    const mode = expected ? Number.parseInt(expected.mode, 8) : 0o644;
    writeFileSync(output, content, { mode });
  }
  return { root: paths.root, files: [...byPath.keys()].sort() };
}
