#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const SHA_RE = /^[0-9a-f]{40}$/i;
const RESULTS = new Set(["pass", "fail", "blocked"]);

function requireText(value, code) {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
}

function validateReceipt(receipt) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) throw new Error("receipt_invalid");
  if (receipt.schema_version !== 1) throw new Error("receipt_schema_unsupported");
  requireText(receipt.run_id, "receipt_run_id_invalid");
  requireText(receipt.repository, "receipt_repository_invalid");
  requireText(receipt.feature, "receipt_feature_invalid");
  if (!SHA_RE.test(String(receipt.head_sha || ""))) throw new Error("receipt_head_sha_invalid");
  if (!RESULTS.has(receipt.result)) throw new Error("receipt_result_invalid");
  if (!RESULTS.has(receipt.cleanup)) throw new Error("receipt_cleanup_invalid");
  for (const field of ["checks", "artifacts", "side_effects", "started_resources"]) {
    if (!Array.isArray(receipt[field])) throw new Error(`receipt_${field}_invalid`);
  }

  if (receipt.result === "pass") {
    if (receipt.cleanup !== "pass") throw new Error("pass_requires_cleanup_pass");
    if (!receipt.checks.length) throw new Error("pass_requires_checks");
    if (receipt.checks.some((check) => check?.result !== "pass")) throw new Error("pass_requires_all_checks_pass");
  }
  if (receipt.result === "blocked") {
    requireText(receipt.blocked_reason, "blocked_requires_reason");
  }
}

export async function evaluateRuntimeVerificationReceipt({ receiptPath, repository, headSha }) {
  const expectedRepository = requireText(repository, "repository_required");
  const expectedHead = requireText(headSha, "head_sha_required");
  if (!SHA_RE.test(expectedHead)) throw new Error("head_sha_invalid");
  const file = requireText(receiptPath, "receipt_path_required");

  let receipt;
  try {
    receipt = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`receipt_read_failed:${error.message}`);
  }
  validateReceipt(receipt);

  if (receipt.repository.toLowerCase() !== expectedRepository.toLowerCase()) {
    throw new Error(`repository_mismatch:${receipt.repository}:${expectedRepository}`);
  }

  const current = receipt.head_sha.toLowerCase() === expectedHead.toLowerCase();
  if (!current) {
    return {
      status: "stale",
      current: false,
      repository: receipt.repository,
      receipt_head_sha: receipt.head_sha,
      expected_head_sha: expectedHead,
      receipt_result: receipt.result,
      feature: receipt.feature,
      run_id: receipt.run_id,
    };
  }

  return {
    status: receipt.result === "pass" ? "pass_current" : receipt.result,
    current: true,
    repository: receipt.repository,
    receipt_head_sha: receipt.head_sha,
    expected_head_sha: expectedHead,
    receipt_result: receipt.result,
    feature: receipt.feature,
    run_id: receipt.run_id,
    blocked_reason: receipt.result === "blocked" ? receipt.blocked_reason : null,
  };
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--receipt") result.receiptPath = argv[++index];
    else if (token === "--repo") result.repository = argv[++index];
    else if (token === "--head") result.headSha = argv[++index];
    else throw new Error(`unknown_argument:${token}`);
  }
  return result;
}

async function main() {
  try {
    const result = await evaluateRuntimeVerificationReceipt(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: "invalid", error: String(error?.message || error) })}\n`);
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
