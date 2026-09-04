#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  captureCommentReviewSnapshot,
  discardCommentReviewSnapshot,
  verifyCommentReviewSnapshot,
} from "./comment-review-guard.mjs";
import { parseCommentReviewScopePatch } from "./comment-review-scope.mjs";
import { isDirectInvocation } from "./lib/direct-invocation.mjs";
import { buildPreOpenHygieneEvidence } from "./lib/pre-open-hygiene-evidence.mjs";
import { boundedSpawnSync } from "./lib/subprocess-policy.mjs";

const USAGE = `Usage:
  node scripts/create-pr-hygiene.mjs prepare --root ROOT --base REF --head REF --scope FILE --snapshot FILE
  node scripts/create-pr-hygiene.mjs finalize --root ROOT --head SHA --scope FILE --snapshot FILE --result FILE --simplify FILE --output FILE`;

function takeOption(argv, name, { required = true } = {}) {
  const index = argv.indexOf(name);
  if (index < 0) {
    if (required) throw new Error(`${name} requires a value`);
    return null;
  }
  if (index + 1 >= argv.length) throw new Error(`${name} requires a value`);
  const value = argv[index + 1];
  argv.splice(index, 2);
  return value;
}

function assertNoUnknown(argv) {
  if (argv.length) throw new Error(`unexpected argument: ${argv[0]}\n${USAGE}`);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(resolve(path), "utf8"));
  } catch (error) {
    throw new Error(`${label}_invalid_json:${error?.message || error}`);
  }
}

function writeJson(path, value) {
  writeFileSync(resolve(path), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function candidatePatch(root, base, head) {
  const result = boundedSpawnSync(
    "git",
    ["-c", "core.quotePath=false", "diff", "--no-ext-diff", "--no-color", "--unified=0", `${base}...${head}`],
    {
      cwd: resolve(root),
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || "git diff failed").trim());
  }
  return String(result.stdout || "");
}

function prepare(argv) {
  const root = takeOption(argv, "--root");
  const base = takeOption(argv, "--base");
  const head = takeOption(argv, "--head");
  const scopePath = takeOption(argv, "--scope");
  const snapshotPath = takeOption(argv, "--snapshot");
  assertNoUnknown(argv);

  const scope = parseCommentReviewScopePatch(candidatePatch(root, base, head), {
    baseRef: base,
    headRef: head,
  });
  writeJson(scopePath, scope);

  const files = scope.files.map((entry) => entry.path);
  const snapshot = files.length
    ? captureCommentReviewSnapshot({ root, files, snapshotPath })
    : { fileCount: 0, totalBytes: 0, files: [] };
  return {
    schemaVersion: 1,
    kind: "github-delivery/create-pr-hygiene-prepare",
    scopePath: resolve(scopePath),
    snapshotPath: files.length ? resolve(snapshotPath) : null,
    scopeDigest: scope.scopeDigest,
    fileCount: files.length,
    snapshot,
  };
}

function finalize(argv) {
  const root = takeOption(argv, "--root");
  const head = takeOption(argv, "--head");
  const scopePath = takeOption(argv, "--scope");
  const snapshotPath = takeOption(argv, "--snapshot");
  const resultPath = takeOption(argv, "--result");
  const simplifyPath = takeOption(argv, "--simplify");
  const outputPath = takeOption(argv, "--output");
  assertNoUnknown(argv);

  const scope = readJson(scopePath, "comment_review_scope");
  const scopedFiles = Array.isArray(scope?.files) ? scope.files : [];
  let guardVerification;
  if (scopedFiles.length === 0) {
    guardVerification = { unchanged: true, changedFiles: [], fileCount: 0 };
  } else {
    guardVerification = verifyCommentReviewSnapshot({ root, snapshotPath });
    if (!guardVerification.unchanged) {
      throw new Error("comment_review_guard_changed_restore_required");
    }
    discardCommentReviewSnapshot({ snapshotPath });
  }

  const evidence = buildPreOpenHygieneEvidence({
    scope,
    commentResult: readJson(resultPath, "comment_review_result"),
    guardVerification,
    simplify: readJson(simplifyPath, "simplify_result"),
    headSha: head,
  });
  writeJson(outputPath, evidence);
  return {
    schemaVersion: 1,
    kind: "github-delivery/create-pr-hygiene-finalize",
    outputPath: resolve(outputPath),
    headSha: evidence.headSha,
    passes: evidence.passes,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv.shift();
  let result;
  if (command === "prepare") result = prepare(argv);
  else if (command === "finalize") result = finalize(argv);
  else throw new Error(USAGE);
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
