#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import { isDirectInvocation } from "./lib/direct-invocation.mjs";
import { boundedSpawnSync } from "./lib/subprocess-policy.mjs";

function parseArgs(argv) {
  let base = null;
  let head = null;
  let output = null;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--base") {
      base = argv[++index];
      if (!base) throw new Error("--base requires a ref");
    } else if (value === "--head") {
      head = argv[++index];
      if (!head) throw new Error("--head requires a ref");
    } else if (value === "--output") {
      output = argv[++index];
      if (!output) throw new Error("--output requires a file path");
    } else {
      throw new Error(`unknown option: ${value}`);
    }
  }
  if (!base || !head) {
    throw new Error("Usage: node scripts/comment-review-scope.mjs --base REF --head REF [--output FILE]");
  }
  return { base, head, output };
}

function decodePatchPath(raw) {
  const value = String(raw || "");
  if (value === "/dev/null") return null;
  if (value.startsWith("\"") && value.endsWith("\"")) {
    try {
      const decoded = JSON.parse(value);
      return decoded.startsWith("b/") ? decoded.slice(2) : decoded;
    } catch {
      throw new Error("comment_review_scope_quoted_path_invalid");
    }
  }
  return value.startsWith("b/") ? value.slice(2) : value;
}

function appendLine(file, line) {
  const ranges = file.addedRanges;
  const previous = ranges.at(-1);
  if (previous && previous.end + 1 === line) {
    previous.end = line;
    return;
  }
  ranges.push({ start: line, end: line });
}

export function parseCommentReviewScopePatch(patch, { baseRef = null, headRef = null } = {}) {
  const files = [];
  let current = null;
  let nextLine = null;

  for (const line of String(patch || "").split(/\r?\n/)) {
    if (line.startsWith("+++ ")) {
      const path = decodePatchPath(line.slice(4));
      current = path ? { path, addedRanges: [] } : null;
      if (current) files.push(current);
      nextLine = null;
      continue;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunk) {
      nextLine = Number(hunk[1]);
      continue;
    }
    if (!current || nextLine === null || line.startsWith("\\ No newline")) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      appendLine(current, nextLine);
      nextLine += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      continue;
    } else {
      nextLine += 1;
    }
  }

  const scopedFiles = files.filter((file) => file.addedRanges.length > 0);
  const core = {
    schemaVersion: 1,
    kind: "github-delivery/comment-review-scope",
    baseRef: baseRef ? String(baseRef) : null,
    headRef: headRef ? String(headRef) : null,
    files: scopedFiles,
  };
  const digest = createHash("sha256")
    .update(JSON.stringify(core), "utf8")
    .digest("hex");
  return { ...core, scopeDigest: `sha256:${digest}` };
}

export function lineInCommentReviewScope(scope, path, line) {
  const file = Array.isArray(scope?.files)
    ? scope.files.find((entry) => entry?.path === path)
    : null;
  if (!file || !Number.isInteger(line) || line < 1) return false;
  return file.addedRanges.some(
    (range) => Number.isInteger(range?.start) && Number.isInteger(range?.end) && line >= range.start && line <= range.end,
  );
}

function gitDiff(base, head) {
  const result = boundedSpawnSync(
    "git",
    ["-c", "core.quotePath=false", "diff", "--no-ext-diff", "--no-color", "--unified=0", `${base}...${head}`],
    { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || "git diff failed").trim());
  }
  return String(result.stdout || "");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scope = parseCommentReviewScopePatch(gitDiff(args.base, args.head), {
    baseRef: args.base,
    headRef: args.head,
  });
  const json = `${JSON.stringify(scope, null, 2)}\n`;
  process.stdout.write(json);
  if (args.output) writeFileSync(args.output, json, "utf8");
}

if (isDirectInvocation(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(String(error?.message || error));
    process.exitCode = 2;
  }
}
