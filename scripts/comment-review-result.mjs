#!/usr/bin/env node
import { readFileSync } from "node:fs";

import { lineInCommentReviewScope } from "./comment-review-scope.mjs";
import { isDirectInvocation } from "./lib/direct-invocation.mjs";

const DISPOSITIONS = new Set(["KEEP", "DELETE"]);

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value, code) {
  const text = String(value || "").trim();
  if (!text) throw new Error(code);
  return text;
}

function validateClassification(scope, entry, seen) {
  if (!plainObject(entry)) throw new Error("comment_review_result_classification_invalid");
  const path = requiredString(entry.path, "comment_review_result_path_required");
  const line = Number(entry.line);
  if (!Number.isInteger(line) || line < 1) throw new Error("comment_review_result_line_invalid");
  if (!lineInCommentReviewScope(scope, path, line)) {
    throw new Error("comment_review_result_scope_escape");
  }
  const disposition = requiredString(entry.disposition, "comment_review_result_disposition_required");
  if (!DISPOSITIONS.has(disposition)) throw new Error("comment_review_result_disposition_invalid");
  const reason = requiredString(entry.reason, "comment_review_result_reason_required");
  const key = `${path}\0${line}`;
  if (seen.has(key)) throw new Error("comment_review_result_duplicate_classification");
  seen.add(key);
  return { path, line, disposition, reason };
}

export function validateCommentReviewResult(scope, value) {
  if (!plainObject(scope) || scope.kind !== "github-delivery/comment-review-scope") {
    throw new Error("comment_review_scope_invalid");
  }
  if (!plainObject(value)) throw new Error("comment_review_result_invalid");
  if (value.schemaVersion !== 1 || value.kind !== "github-delivery/comment-review-result") {
    throw new Error("comment_review_result_schema_invalid");
  }
  if (requiredString(value.scopeDigest, "comment_review_result_scope_digest_required") !== scope.scopeDigest) {
    throw new Error("comment_review_result_scope_mismatch");
  }
  const classifications = Array.isArray(value.classifications) ? value.classifications : null;
  if (!classifications) throw new Error("comment_review_result_classifications_required");
  const seen = new Set();
  const validated = classifications.map((entry) => validateClassification(scope, entry, seen));

  const rootCauseFlags = Array.isArray(value.rootCauseFlags) ? value.rootCauseFlags : [];
  const flags = rootCauseFlags.map((flag) => {
    if (!plainObject(flag)) throw new Error("comment_review_result_flag_invalid");
    const path = requiredString(flag.path, "comment_review_result_flag_path_required");
    const line = Number(flag.line);
    if (!Number.isInteger(line) || line < 1 || !lineInCommentReviewScope(scope, path, line)) {
      throw new Error("comment_review_result_flag_scope_escape");
    }
    const classification = validated.find(
      (entry) => entry.path === path && entry.line === line && entry.disposition === "DELETE",
    );
    if (!classification) throw new Error("comment_review_result_flag_without_delete");
    return {
      path,
      line,
      symbol: requiredString(flag.symbol, "comment_review_result_flag_symbol_required"),
      reason: requiredString(flag.reason, "comment_review_result_flag_reason_required"),
    };
  });

  return {
    schemaVersion: 1,
    kind: "github-delivery/comment-review-result",
    scopeDigest: scope.scopeDigest,
    classifications: validated,
    rootCauseFlags: flags,
    deletionCount: validated.filter((entry) => entry.disposition === "DELETE").length,
  };
}

function parseArgs(argv) {
  let scope = null;
  let result = null;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--scope") {
      scope = argv[++index];
      if (!scope) throw new Error("--scope requires a file path");
    } else if (value === "--result") {
      result = argv[++index];
      if (!result) throw new Error("--result requires a file path");
    } else {
      throw new Error(`unknown option: ${value}`);
    }
  }
  if (!scope || !result) {
    throw new Error("Usage: node scripts/comment-review-result.mjs --scope FILE --result FILE");
  }
  return { scope, result };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scope = JSON.parse(readFileSync(args.scope, "utf8"));
  const result = JSON.parse(readFileSync(args.result, "utf8"));
  process.stdout.write(`${JSON.stringify(validateCommentReviewResult(scope, result), null, 2)}\n`);
}

if (isDirectInvocation(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(String(error?.message || error));
    process.exitCode = 2;
  }
}
