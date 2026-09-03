#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { isDirectInvocation } from "./lib/direct-invocation.mjs";

const SNAPSHOT_SCHEMA_VERSION = 1;
const SNAPSHOT_KIND = "github-delivery/comment-review-snapshot";
const USAGE = `Usage:
  node scripts/comment-review-guard.mjs capture --root ROOT --files FILE --snapshot FILE
  node scripts/comment-review-guard.mjs verify --root ROOT --snapshot FILE
  node scripts/comment-review-guard.mjs restore --root ROOT --snapshot FILE
  node scripts/comment-review-guard.mjs discard --snapshot FILE`;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sortedUnique(values) {
  return [...new Set((values || []).map(String).filter(Boolean))].sort();
}

function canonicalRoot(root) {
  const resolved = resolve(String(root || ""));
  const stat = lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("comment_review_root_invalid");
  }
  return realpathSync(resolved);
}

function normalizedScopePath(root, value, { allowMissing = false } = {}) {
  const raw = String(value || "").trim();
  if (!raw || isAbsolute(raw)) throw new Error(`comment_review_scope_path_invalid:${raw || "(empty)"}`);
  const absolute = resolve(root, raw);
  const lexical = relative(root, absolute);
  if (!lexical || lexical === ".." || lexical.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(lexical)) {
    throw new Error(`comment_review_scope_path_invalid:${raw}`);
  }

  if (!allowMissing || existsSync(absolute)) {
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`comment_review_scope_file_invalid:${raw}`);
    }
    const canonical = realpathSync(absolute);
    const physical = relative(root, canonical);
    if (!physical || physical === ".." || physical.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(physical)) {
      throw new Error(`comment_review_scope_path_invalid:${raw}`);
    }
  } else {
    const parent = realpathSync(dirname(absolute));
    const physicalParent = relative(root, parent);
    if (physicalParent === ".." || physicalParent.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(physicalParent)) {
      throw new Error(`comment_review_scope_path_invalid:${raw}`);
    }
  }

  return { path: lexical.replaceAll("\\", "/"), absolute };
}

function writePrivateSnapshot(path, value) {
  const target = resolve(path);
  const fd = openSync(target, "wx", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  } finally {
    closeSync(fd);
  }
  try {
    chmodSync(target, 0o600);
  } catch {
    // Best effort on platforms/filesystems without POSIX mode semantics.
  }
}

function readSnapshot(snapshotPath) {
  const target = resolve(String(snapshotPath || ""));
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("comment_review_snapshot_invalid");
  const parsed = JSON.parse(readFileSync(target, "utf8"));
  if (
    parsed?.schemaVersion !== SNAPSHOT_SCHEMA_VERSION ||
    parsed?.kind !== SNAPSHOT_KIND ||
    typeof parsed?.root !== "string" ||
    !Array.isArray(parsed?.files)
  ) {
    throw new Error("comment_review_snapshot_invalid");
  }
  return parsed;
}

function assertSnapshotRoot(root, snapshot) {
  const canonical = canonicalRoot(root);
  if (canonical !== snapshot.root) throw new Error("comment_review_snapshot_root_mismatch");
  return canonical;
}

function entryState(root, entry) {
  const scoped = normalizedScopePath(root, entry.path, { allowMissing: true });
  if (!existsSync(scoped.absolute)) return { ...scoped, changed: true, reason: "missing" };
  const bytes = readFileSync(scoped.absolute);
  const digest = sha256(bytes);
  if (digest !== entry.sha256 || bytes.toString("base64") !== entry.contentBase64) {
    return { ...scoped, changed: true, reason: "bytes_changed" };
  }
  return { ...scoped, changed: false, reason: null };
}

export function captureCommentReviewSnapshot({ root, files, snapshotPath } = {}) {
  const canonical = canonicalRoot(root);
  const paths = sortedUnique(files);
  if (paths.length === 0) throw new Error("comment_review_scope_files_required");
  const entries = paths.map((path) => {
    const scoped = normalizedScopePath(canonical, path);
    const stat = lstatSync(scoped.absolute);
    const bytes = readFileSync(scoped.absolute);
    return {
      path: scoped.path,
      sha256: sha256(bytes),
      contentBase64: bytes.toString("base64"),
      mode: stat.mode & 0o777,
    };
  });
  writePrivateSnapshot(snapshotPath, {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    kind: SNAPSHOT_KIND,
    root: canonical,
    files: entries,
  });
  return { fileCount: entries.length, files: entries.map((entry) => entry.path) };
}

export function verifyCommentReviewSnapshot({ root, snapshotPath } = {}) {
  const snapshot = readSnapshot(snapshotPath);
  const canonical = assertSnapshotRoot(root, snapshot);
  const changedFiles = snapshot.files
    .filter((entry) => entryState(canonical, entry).changed)
    .map((entry) => entry.path)
    .sort();
  return {
    unchanged: changedFiles.length === 0,
    changedFiles,
    fileCount: snapshot.files.length,
  };
}

export function restoreCommentReviewSnapshot({ root, snapshotPath } = {}) {
  const snapshot = readSnapshot(snapshotPath);
  const canonical = assertSnapshotRoot(root, snapshot);
  const restoredFiles = [];
  for (const entry of snapshot.files) {
    const state = entryState(canonical, entry);
    if (!state.changed) continue;
    if (existsSync(state.absolute)) {
      const stat = lstatSync(state.absolute);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error(`comment_review_restore_target_invalid:${entry.path}`);
      }
    }
    const bytes = Buffer.from(entry.contentBase64, "base64");
    if (sha256(bytes) !== entry.sha256) throw new Error("comment_review_snapshot_corrupt");
    writeFileSync(state.absolute, bytes);
    try {
      chmodSync(state.absolute, entry.mode);
    } catch {
      // Best effort on platforms/filesystems without POSIX mode semantics.
    }
    restoredFiles.push(entry.path);
  }
  const verification = verifyCommentReviewSnapshot({ root: canonical, snapshotPath });
  if (!verification.unchanged) throw new Error("comment_review_restore_verification_failed");
  return { restoredFiles: restoredFiles.sort(), fileCount: snapshot.files.length };
}

export function discardCommentReviewSnapshot({ snapshotPath } = {}) {
  const target = resolve(String(snapshotPath || ""));
  if (!existsSync(target)) return { discarded: false };
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("comment_review_snapshot_invalid");
  unlinkSync(target);
  return { discarded: true };
}

function readFilesList(path) {
  const parsed = JSON.parse(readFileSync(resolve(path), "utf8"));
  const files = Array.isArray(parsed) ? parsed : parsed?.files;
  if (!Array.isArray(files) || !files.every((item) => typeof item === "string")) {
    throw new Error("comment_review_scope_file_list_invalid");
  }
  return files;
}

function takeOption(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  if (index + 1 >= argv.length) throw new Error(`${name} requires a value`);
  const value = argv[index + 1];
  argv.splice(index, 2);
  return value;
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv.shift();
  if (!command) throw new Error(USAGE);
  let result;
  if (command === "capture") {
    const root = takeOption(argv, "--root");
    const filesPath = takeOption(argv, "--files");
    const snapshotPath = takeOption(argv, "--snapshot");
    if (!root || !filesPath || !snapshotPath || argv.length) throw new Error(USAGE);
    result = captureCommentReviewSnapshot({
      root,
      files: readFilesList(filesPath),
      snapshotPath,
    });
  } else if (command === "verify") {
    const root = takeOption(argv, "--root");
    const snapshotPath = takeOption(argv, "--snapshot");
    if (!root || !snapshotPath || argv.length) throw new Error(USAGE);
    result = verifyCommentReviewSnapshot({ root, snapshotPath });
    if (!result.unchanged) process.exitCode = 1;
  } else if (command === "restore") {
    const root = takeOption(argv, "--root");
    const snapshotPath = takeOption(argv, "--snapshot");
    if (!root || !snapshotPath || argv.length) throw new Error(USAGE);
    result = restoreCommentReviewSnapshot({ root, snapshotPath });
  } else if (command === "discard") {
    const snapshotPath = takeOption(argv, "--snapshot");
    if (!snapshotPath || argv.length) throw new Error(USAGE);
    result = discardCommentReviewSnapshot({ snapshotPath });
  } else {
    throw new Error(USAGE);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (isDirectInvocation(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(String(error?.message || error));
    process.exitCode = 2;
  }
}
