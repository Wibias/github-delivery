import { readFileSync } from "node:fs";
import { summarizeSources } from "./snapshot-schema.mjs";

const SNAPSHOT_KIND = "shipping-github/evidence-snapshot";
const SNAPSHOT_SCHEMA_VERSION = 1;

function positiveNumber(value, option) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${option} requires a non-negative number`);
  }
  return number;
}

export function parseSnapshotGateArgs(
  argv,
  { usage, allowResolve = false } = {},
) {
  const positionals = [];
  let snapshotPath = null;
  let expectedHead = null;
  let maxAgeSeconds = 300;
  let resolveId = null;

  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === "--snapshot") {
      snapshotPath = argv[++index];
      if (!snapshotPath) throw new Error("--snapshot requires a file path");
      continue;
    }
    if (value === "--expected-head") {
      expectedHead = argv[++index];
      if (!expectedHead) throw new Error("--expected-head requires a SHA");
      continue;
    }
    if (value === "--max-age-seconds") {
      const raw = argv[++index];
      if (raw === undefined) {
        throw new Error("--max-age-seconds requires a number");
      }
      maxAgeSeconds = positiveNumber(raw, "--max-age-seconds");
      continue;
    }
    if (value === "--resolve" && allowResolve) {
      resolveId = argv[++index];
      if (!resolveId) throw new Error("--resolve requires a review thread ID");
      continue;
    }
    if (value.startsWith("--")) throw new Error(`Unknown option: ${value}`);
    positionals.push(value);
  }

  const [repo, prRaw] = positionals;
  const pr = Number(prRaw);
  if (
    positionals.length !== 2 ||
    !repo?.includes("/") ||
    !Number.isInteger(pr) ||
    pr <= 0
  ) {
    throw new Error(usage || "Usage: OWNER/REPO PR_NUMBER [--snapshot FILE]");
  }
  if (snapshotPath && resolveId) {
    throw new Error("--resolve cannot be used with --snapshot");
  }

  return {
    repo,
    pr,
    snapshotPath,
    expectedHead,
    maxAgeSeconds,
    resolveId,
  };
}

export function validateSnapshot({
  snapshot,
  repo,
  pr,
  expectedHead = null,
  maxAgeSeconds = 300,
  now = Date.now(),
  requireComplete = true,
} = {}) {
  const reasons = [];
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return { valid: false, reasons: ["snapshot_not_object"] };
  }
  if (snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    reasons.push("unsupported_schema_version");
  }
  if (snapshot.kind !== SNAPSHOT_KIND) reasons.push("unexpected_snapshot_kind");
  if (repo && snapshot.repo !== repo) reasons.push("repo_mismatch");
  if (pr && snapshot.pr !== pr) reasons.push("pr_mismatch");
  if (!snapshot.headOid || typeof snapshot.headOid !== "string") {
    reasons.push("head_missing");
  }

  const evidenceHead = snapshot.evidence?.pullRequest?.headRefOid;
  if (!evidenceHead || evidenceHead !== snapshot.headOid) {
    reasons.push("head_evidence_mismatch");
  }
  const evidencePr = snapshot.evidence?.pullRequest?.number;
  if (Number.isInteger(evidencePr) && evidencePr !== snapshot.pr) {
    reasons.push("pr_evidence_mismatch");
  }
  if (expectedHead && snapshot.headOid !== expectedHead) {
    reasons.push("expected_head_mismatch");
  }

  const capturedAt = Date.parse(snapshot.capturedAt || "");
  if (!Number.isFinite(capturedAt)) {
    reasons.push("captured_at_invalid");
  } else {
    if (capturedAt > now + 60_000) reasons.push("snapshot_from_future");
    if (Number.isFinite(maxAgeSeconds) && now - capturedAt > maxAgeSeconds * 1000) {
      reasons.push("snapshot_stale");
    }
  }

  const summary = summarizeSources(snapshot.sources || {});
  if (
    requireComplete &&
    (snapshot.complete !== true || summary.incomplete.length > 0)
  ) {
    reasons.push("snapshot_incomplete");
  }

  return { valid: reasons.length === 0, reasons: [...new Set(reasons)] };
}

export function readValidatedSnapshot({ path, ...options } = {}) {
  if (!path) throw new Error("snapshot path is required");
  let snapshot;
  try {
    snapshot = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Could not read snapshot: ${error?.message || error}`);
  }
  const validation = validateSnapshot({ snapshot, ...options });
  if (!validation.valid) {
    throw new Error(`Invalid snapshot: ${validation.reasons.join(", ")}`);
  }
  return snapshot;
}
