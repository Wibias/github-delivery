import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { extractVerifiedReleaseZip, verifyExtractedReleaseTree } from "../../scripts/lib/release-zip.mjs";

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

function makeStoredZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const raw of entries) {
    const entry = {
      flags: 0x0800,
      method: 0,
      mode: 0o100644,
      ...raw,
    };
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data || "");
    const checksum = entry.crc32 ?? crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.flags, 6);
    local.writeUInt16LE(entry.method, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.flags, 8);
    central.writeUInt16LE(entry.method, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((entry.mode & 0xffff) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, end]);
}

function fixture({ extraManifestFiles = [], packageData = '{"name":"github-delivery","version":"0.5.0"}\n' } = {}) {
  const packageBuffer = Buffer.from(packageData);
  const manifest = {
    schemaVersion: 1,
    kind: "github-delivery/distribution-manifest",
    name: "github-delivery",
    version: "0.5.0",
    sourceCommit: "a".repeat(40),
    files: [
      {
        path: "package.json",
        bytes: packageBuffer.length,
        mode: "0644",
        sha256: sha256(packageBuffer),
      },
      ...extraManifestFiles,
    ],
  };
  const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
  return {
    manifest,
    manifestBuffer,
    packageBuffer,
    entries: [
      { name: "github-delivery/package.json", data: packageBuffer },
      { name: "github-delivery/manifest.json", data: manifestBuffer },
    ],
  };
}

function withTemp(callback) {
  const root = mkdtempSync(join(tmpdir(), "gd-release-zip-"));
  try { return callback(root); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test("extracts a verified stored release ZIP beneath one github-delivery root", () => withTemp((root) => {
  const value = fixture();
  const result = extractVerifiedReleaseZip({
    archive: makeStoredZip(value.entries),
    manifest: value.manifest,
    manifestBytes: value.manifestBuffer,
    destination: root,
  });
  assert.equal(result.root, join(root, "github-delivery"));
  assert.deepEqual(readFileSync(join(result.root, "package.json")), value.packageBuffer);
}));

for (const name of [
  "../outside",
  "/github-delivery/file",
  "C:/github-delivery/file",
  "\\\\server\\share\\file",
  "github-delivery/../../outside",
  "github-delivery/a\\..\\outside",
  "github-delivery/./file",
]) {
  test(`rejects unsafe ZIP path ${JSON.stringify(name)}`, () => withTemp((root) => {
    const value = fixture();
    const archive = makeStoredZip([...value.entries, { name, data: "x" }]);
    assert.throws(
      () => extractVerifiedReleaseZip({ archive, manifest: value.manifest, manifestBytes: value.manifestBuffer, destination: root }),
      /release_zip_path_invalid/,
    );
  }));
}

test("rejects duplicate normalized entries", () => withTemp((root) => {
  const value = fixture();
  const archive = makeStoredZip([...value.entries, { name: "github-delivery/package.json", data: value.packageBuffer }]);
  assert.throws(
    () => extractVerifiedReleaseZip({ archive, manifest: value.manifest, manifestBytes: value.manifestBuffer, destination: root }),
    /release_zip_entry_duplicate/,
  );
}));

test("rejects symbolic-link file mode", () => withTemp((root) => {
  const value = fixture();
  const entries = value.entries.map((entry) => entry.name === "github-delivery/package.json"
    ? { ...entry, mode: 0o120777 }
    : entry);
  assert.throws(
    () => extractVerifiedReleaseZip({ archive: makeStoredZip(entries), manifest: value.manifest, manifestBytes: value.manifestBuffer, destination: root }),
    /release_zip_file_type_unsupported/,
  );
}));

test("rejects undeclared archive files", () => withTemp((root) => {
  const value = fixture();
  const archive = makeStoredZip([...value.entries, { name: "github-delivery/extra.txt", data: "extra" }]);
  assert.throws(
    () => extractVerifiedReleaseZip({ archive, manifest: value.manifest, manifestBytes: value.manifestBuffer, destination: root }),
    /release_zip_file_undeclared/,
  );
}));

test("rejects a manifest-declared file missing from the archive", () => withTemp((root) => {
  const missing = Buffer.from("missing");
  const value = fixture({ extraManifestFiles: [{ path: "missing.txt", bytes: missing.length, mode: "0644", sha256: sha256(missing) }] });
  assert.throws(
    () => extractVerifiedReleaseZip({ archive: makeStoredZip(value.entries), manifest: value.manifest, manifestBytes: value.manifestBuffer, destination: root }),
    /release_zip_manifest_file_missing/,
  );
}));

test("rejects archive manifest bytes that differ from the separately verified manifest", () => withTemp((root) => {
  const value = fixture();
  const entries = value.entries.map((entry) => entry.name === "github-delivery/manifest.json"
    ? { ...entry, data: Buffer.from("{}\n") }
    : entry);
  assert.throws(
    () => extractVerifiedReleaseZip({ archive: makeStoredZip(entries), manifest: value.manifest, manifestBytes: value.manifestBuffer, destination: root }),
    /release_zip_manifest_mismatch/,
  );
}));

test("rejects CRC mismatch", () => withTemp((root) => {
  const value = fixture();
  const entries = value.entries.map((entry) => entry.name === "github-delivery/package.json"
    ? { ...entry, crc32: 0 }
    : entry);
  assert.throws(
    () => extractVerifiedReleaseZip({ archive: makeStoredZip(entries), manifest: value.manifest, manifestBytes: value.manifestBuffer, destination: root }),
    /release_zip_crc_mismatch/,
  );
}));

test("rejects unsupported compression", () => withTemp((root) => {
  const value = fixture();
  const entries = value.entries.map((entry) => entry.name === "github-delivery/package.json"
    ? { ...entry, method: 8 }
    : entry);
  assert.throws(
    () => extractVerifiedReleaseZip({ archive: makeStoredZip(entries), manifest: value.manifest, manifestBytes: value.manifestBuffer, destination: root }),
    /release_zip_compression_unsupported/,
  );
}));

test("enforces per-file and total extraction limits before writing", () => withTemp((root) => {
  const value = fixture({ packageData: "x".repeat(128) });
  assert.throws(
    () => extractVerifiedReleaseZip({
      archive: makeStoredZip(value.entries),
      manifest: value.manifest,
      manifestBytes: value.manifestBuffer,
      destination: root,
      limits: { maxArchiveBytes: 1024 * 1024, maxFileBytes: 64, maxTotalBytes: 1024, maxFiles: 20 },
    }),
    /release_zip_file_limit_exceeded/,
  );
}));

test("rejects case-aliased ZIP paths before writing", () => withTemp((root) => {
  const value = fixture();
  const extra = Buffer.from("other");
  value.manifest.files.push({
    path: "Package.json",
    bytes: extra.length,
    mode: "0644",
    sha256: sha256(extra),
  });
  value.manifestBuffer = Buffer.from(JSON.stringify(value.manifest, null, 2) + "\n");
  value.entries = [
    { name: "github-delivery/package.json", data: value.packageBuffer },
    { name: "github-delivery/Package.json", data: extra },
    { name: "github-delivery/manifest.json", data: value.manifestBuffer },
  ];
  assert.throws(
    () => extractVerifiedReleaseZip({
      archive: makeStoredZip(value.entries),
      manifest: value.manifest,
      manifestBytes: value.manifestBuffer,
      destination: root,
    }),
    /release_zip_path_alias/,
  );
}));

test("rejects non-NFC ZIP paths even when they are unique strings", () => withTemp((root) => {
  const value = fixture();
  const nfd = Buffer.from("nfd");
  const path = "cafe\u0301.json";
  value.manifest.files.push({
    path,
    bytes: nfd.length,
    mode: "0644",
    sha256: sha256(nfd),
  });
  value.manifestBuffer = Buffer.from(JSON.stringify(value.manifest, null, 2) + "\n");
  value.entries = [
    { name: "github-delivery/package.json", data: value.packageBuffer },
    { name: `github-delivery/${path}`, data: nfd },
    { name: "github-delivery/manifest.json", data: value.manifestBuffer },
  ];
  assert.throws(
    () => extractVerifiedReleaseZip({
      archive: makeStoredZip(value.entries),
      manifest: value.manifest,
      manifestBytes: value.manifestBuffer,
      destination: root,
    }),
    /release_zip_path_not_nfc/,
  );
}));

test("post-extraction verification fails closed on content or type drift", () => withTemp((root) => {
  const value = fixture();
  const extracted = extractVerifiedReleaseZip({
    archive: makeStoredZip(value.entries),
    manifest: value.manifest,
    manifestBytes: value.manifestBuffer,
    destination: root,
  });
  writeFileSync(join(extracted.root, "package.json"), "tampered");
  assert.throws(
    () => verifyExtractedReleaseTree({
      root: extracted.root,
      manifest: value.manifest,
      files: extracted.files,
    }),
    /release_zip_extracted_mismatch/,
  );
  rmSync(join(extracted.root, "package.json"));
  mkdirSync(join(extracted.root, "package.json"));
  assert.throws(
    () => verifyExtractedReleaseTree({
      root: extracted.root,
      manifest: value.manifest,
      files: extracted.files,
    }),
    /release_zip_extracted_not_regular/,
  );
}));
