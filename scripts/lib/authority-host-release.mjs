import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { TextDecoder } from "node:util";

import {
  verifyGitHubAssetDigest,
  verifyReleaseAttestation,
} from "./release-self-update.mjs";

const ROOT = "GitHubDeliveryAuthority/";
const UTF8_FLAG = 0x0800;
const ENCRYPTED_FLAG = 0x0001;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const STORED_METHOD = 0;
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const decoder = new TextDecoder("utf-8", { fatal: true });
const LIMITS = Object.freeze({
  archive: 384 * 1024 * 1024,
  metadata: 4 * 1024 * 1024,
  file: 192 * 1024 * 1024,
  total: 768 * 1024 * 1024,
  files: 4096,
});

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

function isCommit(value) {
  return typeof value === "string" && /^[0-9a-f]{40}$/i.test(value);
}

function isVersion(value) {
  return typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value);
}

function assetName(version, extension) {
  return `github-delivery-authority-v${version}-win-x64.${extension}`;
}

function uniqueAsset(release, name) {
  const matches = (release?.assets || []).filter((entry) => entry?.name === name);
  if (matches.length === 0) fail("authority_host_release_asset_missing", name);
  if (matches.length > 1) fail("authority_host_release_asset_duplicate", name);
  return matches[0];
}

function safeRelativePath(path) {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.includes("\0") ||
    path.includes("\\") ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path)
  ) fail("authority_host_release_path_invalid", String(path));
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    fail("authority_host_release_path_invalid", path);
  }
  return path;
}

export function validateAuthorityHostReleaseMetadata(value, { version, sourceCommit } = {}) {
  if (!isVersion(version) || !isCommit(sourceCommit)) fail("authority_host_release_expected_identity_invalid");
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    value.schemaVersion !== 1 ||
    value.kind !== "github-delivery/authority-host-release" ||
    value.version !== version ||
    String(value.sourceCommit || "").toLowerCase() !== sourceCommit.toLowerCase() ||
    value.platform !== "win32" ||
    value.arch !== "x64" ||
    value.archive !== assetName(version, "zip") ||
    !/^[0-9a-f]{64}$/i.test(String(value.sha256 || "")) ||
    !Array.isArray(value.files) || value.files.length === 0 || value.files.length > LIMITS.files
  ) fail("authority_host_release_metadata_invalid");

  const seen = new Set();
  let total = 0;
  const files = value.files.map((entry) => {
    const path = safeRelativePath(entry?.path);
    if (seen.has(path)) fail("authority_host_release_metadata_duplicate_path", path);
    seen.add(path);
    if (!Number.isSafeInteger(entry?.bytes) || entry.bytes < 0 || entry.bytes > LIMITS.file) {
      fail("authority_host_release_metadata_invalid", path);
    }
    if (!/^[0-9a-f]{64}$/i.test(String(entry?.sha256 || ""))) fail("authority_host_release_metadata_invalid", path);
    total += entry.bytes;
    if (!Number.isSafeInteger(total) || total > LIMITS.total) fail("authority_host_release_total_limit_exceeded");
    return { path, bytes: entry.bytes, sha256: entry.sha256.toLowerCase() };
  });
  if (!seen.has("GitHubDeliveryAuthority.exe") || !seen.has("authority-host-version.json")) {
    fail("authority_host_release_required_file_missing");
  }
  return {
    schemaVersion: 1,
    kind: value.kind,
    version,
    sourceCommit: sourceCommit.toLowerCase(),
    platform: "win32",
    arch: "x64",
    archive: value.archive,
    sha256: value.sha256.toLowerCase(),
    files,
  };
}

function decodeName(bytes) {
  try { return decoder.decode(bytes); }
  catch { fail("authority_host_release_zip_name_invalid"); }
}

function findEocd(archive) {
  const minimum = Math.max(0, archive.length - 65_557);
  for (let offset = archive.length - 22; offset >= minimum; offset -= 1) {
    if (archive.readUInt32LE(offset) !== EOCD_SIGNATURE) continue;
    const commentLength = archive.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === archive.length) return offset;
  }
  fail("authority_host_release_zip_eocd_missing");
}

function parseZip(archive) {
  if (!Buffer.isBuffer(archive) || archive.length < 22 || archive.length > LIMITS.archive) {
    fail("authority_host_release_zip_invalid");
  }
  const eocd = findEocd(archive);
  const disk = archive.readUInt16LE(eocd + 4);
  const centralDisk = archive.readUInt16LE(eocd + 6);
  const entriesOnDisk = archive.readUInt16LE(eocd + 8);
  const entryCount = archive.readUInt16LE(eocd + 10);
  const centralSize = archive.readUInt32LE(eocd + 12);
  const centralOffset = archive.readUInt32LE(eocd + 16);
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount || entryCount === 0 || entryCount > LIMITS.files) {
    fail("authority_host_release_zip_structure_invalid");
  }
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff || centralOffset + centralSize !== eocd) {
    fail("authority_host_release_zip_structure_invalid");
  }

  const entries = [];
  const seen = new Set();
  let cursor = centralOffset;
  let total = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > eocd || archive.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) fail("authority_host_release_zip_central_invalid");
    const flags = archive.readUInt16LE(cursor + 8);
    const method = archive.readUInt16LE(cursor + 10);
    const checksum = archive.readUInt32LE(cursor + 16);
    const compressedBytes = archive.readUInt32LE(cursor + 20);
    const bytes = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const diskStart = archive.readUInt16LE(cursor + 34);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const end = cursor + 46 + nameLength + extraLength + commentLength;
    if (end > eocd || diskStart !== 0 || (flags & ENCRYPTED_FLAG) !== 0 || (flags & DATA_DESCRIPTOR_FLAG) !== 0 || (flags & UTF8_FLAG) === 0) {
      fail("authority_host_release_zip_entry_invalid");
    }
    if (method !== STORED_METHOD || compressedBytes !== bytes || extraLength !== 0 || commentLength !== 0 || bytes > LIMITS.file) {
      fail("authority_host_release_zip_entry_invalid");
    }
    total += bytes;
    if (!Number.isSafeInteger(total) || total > LIMITS.total) fail("authority_host_release_total_limit_exceeded");

    const nameBytes = archive.subarray(cursor + 46, cursor + 46 + nameLength);
    const fullPath = decodeName(nameBytes);
    if (!fullPath.startsWith(ROOT) || fullPath === ROOT.slice(0, -1)) fail("authority_host_release_zip_path_invalid", fullPath);
    const relativePath = safeRelativePath(fullPath.slice(ROOT.length));
    if (seen.has(relativePath)) fail("authority_host_release_zip_duplicate_path", relativePath);
    seen.add(relativePath);

    if (localOffset + 30 > centralOffset || archive.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) fail("authority_host_release_zip_local_invalid", relativePath);
    const localFlags = archive.readUInt16LE(localOffset + 6);
    const localMethod = archive.readUInt16LE(localOffset + 8);
    const localChecksum = archive.readUInt32LE(localOffset + 14);
    const localCompressed = archive.readUInt32LE(localOffset + 18);
    const localBytes = archive.readUInt32LE(localOffset + 22);
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    if (localFlags !== flags || localMethod !== method || localChecksum !== checksum || localCompressed !== compressedBytes || localBytes !== bytes || localExtraLength !== 0) {
      fail("authority_host_release_zip_local_mismatch", relativePath);
    }
    const localNameStart = localOffset + 30;
    const localNameEnd = localNameStart + localNameLength;
    if (localNameEnd > centralOffset || !archive.subarray(localNameStart, localNameEnd).equals(nameBytes)) {
      fail("authority_host_release_zip_local_mismatch", relativePath);
    }
    const dataOffset = localNameEnd;
    const dataEnd = dataOffset + bytes;
    if (dataEnd > centralOffset) fail("authority_host_release_zip_bounds_invalid", relativePath);
    const content = archive.subarray(dataOffset, dataEnd);
    if (crc32(content) !== checksum) fail("authority_host_release_zip_crc_mismatch", relativePath);
    entries.push({ relativePath, content });
    cursor = end;
  }
  if (cursor !== eocd) fail("authority_host_release_zip_central_invalid");
  return entries;
}

export function extractVerifiedAuthorityHostZip({ archive, metadata, destination } = {}) {
  const entries = parseZip(archive);
  const expected = new Map(metadata.files.map((entry) => [entry.path, entry]));
  if (entries.length !== expected.size) fail("authority_host_release_zip_file_set_mismatch");
  for (const entry of entries) {
    const declared = expected.get(entry.relativePath);
    if (!declared || entry.content.length !== declared.bytes || sha256(entry.content) !== declared.sha256) {
      fail("authority_host_release_zip_file_mismatch", entry.relativePath);
    }
  }

  destination = resolve(String(destination || ""));
  if (existsSync(destination) && lstatSync(destination).isSymbolicLink()) fail("authority_host_release_destination_unsafe");
  const root = join(destination, "GitHubDeliveryAuthority");
  if (existsSync(root)) fail("authority_host_release_destination_exists");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  for (const entry of entries) {
    const segments = entry.relativePath.split("/");
    const output = join(root, ...segments);
    if (segments.length > 1) mkdirSync(join(root, ...segments.slice(0, -1)), { recursive: true, mode: 0o700 });
    writeFileSync(output, entry.content, { mode: 0o600, flag: "wx" });
  }

  const embedded = JSON.parse(entries.find((entry) => entry.relativePath === "authority-host-version.json").content.toString("utf8"));
  if (
    embedded?.schemaVersion !== 1 || embedded?.kind !== "github-delivery/authority-host-version" ||
    embedded?.version !== metadata.version || String(embedded?.sourceCommit || "").toLowerCase() !== metadata.sourceCommit ||
    embedded?.platform !== "win32" || embedded?.arch !== "x64"
  ) fail("authority_host_release_embedded_version_invalid");
  return { root, files: entries.map((entry) => entry.relativePath).sort() };
}

function parseMetadata(bytes, expected) {
  let parsed;
  try { parsed = JSON.parse(bytes.toString("utf8")); }
  catch { fail("authority_host_release_metadata_invalid_json"); }
  return validateAuthorityHostReleaseMetadata(parsed, expected);
}

function equalHash(leftHex, rightHex) {
  const left = Buffer.from(leftHex, "hex");
  const right = Buffer.from(rightHex, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function acquireVerifiedAuthorityHostPayload({
  release,
  workspace,
  client,
  expectedVersion,
  expectedSourceCommit,
  attestationRunner = undefined,
} = {}) {
  if (!client || typeof client.downloadAsset !== "function" || typeof client.resolveTagCommit !== "function") fail("authority_host_release_client_invalid");
  if (!release || release.draft !== false || release.prerelease !== false || release.tag_name !== `v${expectedVersion}`) fail("authority_host_release_identity_invalid");
  if (!isVersion(expectedVersion) || !isCommit(expectedSourceCommit)) fail("authority_host_release_expected_identity_invalid");

  const metadataAsset = uniqueAsset(release, assetName(expectedVersion, "json"));
  const archiveAsset = uniqueAsset(release, assetName(expectedVersion, "zip"));
  const metadataBytes = await client.downloadAsset(metadataAsset, LIMITS.metadata);
  if (!Buffer.isBuffer(metadataBytes)) fail("authority_host_release_download_invalid");
  verifyGitHubAssetDigest(metadataAsset, metadataBytes);

  const resolvedCommit = await client.resolveTagCommit(release.tag_name);
  if (resolvedCommit.toLowerCase() !== expectedSourceCommit.toLowerCase()) fail("authority_host_release_source_commit_mismatch");
  const metadata = parseMetadata(metadataBytes, { version: expectedVersion, sourceCommit: expectedSourceCommit });

  const archive = await client.downloadAsset(archiveAsset, LIMITS.archive);
  if (!Buffer.isBuffer(archive)) fail("authority_host_release_download_invalid");
  verifyGitHubAssetDigest(archiveAsset, archive);
  const actualHash = sha256(archive);
  if (!equalHash(actualHash, metadata.sha256)) fail("authority_host_release_archive_digest_mismatch");

  const root = resolve(String(workspace || ""));
  const downloads = join(root, "authority-downloads");
  const extraction = join(root, "authority-extracted");
  mkdirSync(downloads, { recursive: true, mode: 0o700 });
  mkdirSync(extraction, { recursive: true, mode: 0o700 });
  const archivePath = join(downloads, metadata.archive);
  writeFileSync(archivePath, archive, { mode: 0o600, flag: "wx" });
  verifyReleaseAttestation({
    archivePath,
    tag: release.tag_name,
    sourceCommit: expectedSourceCommit,
    ...(attestationRunner ? { runner: attestationRunner } : {}),
  });
  const extracted = extractVerifiedAuthorityHostZip({ archive, metadata, destination: extraction });
  return {
    schemaVersion: 1,
    kind: "github-delivery/verified-authority-host-payload",
    verified: true,
    source: extracted.root,
    archivePath,
    metadata,
    release: {
      tag: release.tag_name,
      version: expectedVersion,
      sourceCommit: expectedSourceCommit.toLowerCase(),
    },
  };
}

export const authorityHostReleaseDefaults = Object.freeze({ root: ROOT, limits: LIMITS });
