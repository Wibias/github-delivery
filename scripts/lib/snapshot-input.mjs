import { readFileSync } from "node:fs";
import { snapshotIntegritySha256, summarizeSources } from "./snapshot-schema.mjs";

const SNAPSHOT_KIND = "github-delivery/evidence-snapshot";
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
  { usage, allowResolve = false, allowResolveBot = false } = {},
) {
  const positionals = [];
  let snapshotPath = null;
  let checkpointPath = null;
  let expectedHead = null;
  let maxAgeSeconds = 300;
  let resolveId = null;
  let resolveBot = false;
  let workflow = null;

  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === "--workflow") {
      workflow = argv[++index];
      if (!workflow) throw new Error("--workflow requires a workflow reference");
      continue;
    }
    if (value === "--snapshot") {
      snapshotPath = argv[++index];
      if (!snapshotPath) throw new Error("--snapshot requires a file path");
      continue;
    }
    if (value === "--checkpoint") {
      checkpointPath = argv[++index];
      if (!checkpointPath) throw new Error("--checkpoint requires a file path");
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
    if (value === "--resolve-bot" && allowResolveBot) {
      resolveBot = true;
      continue;
    }
    if (value.startsWith("--")) throw new Error(`Unknown option: ${value}`);
    positionals.push(value);
  }

  let repo = null;
  let pr = null;
  if (positionals.length > 0) {
    const [repoRaw, prRaw] = positionals;
    const parsedPr = Number(prRaw);
    if (
      positionals.length !== 2 ||
      !repoRaw?.includes("/") ||
      !Number.isInteger(parsedPr) ||
      parsedPr <= 0
    ) {
      throw new Error(usage || "Usage: OWNER/REPO PR_NUMBER [--snapshot FILE]");
    }
    repo = repoRaw;
    pr = parsedPr;
  } else if (!checkpointPath) {
    throw new Error(usage || "Usage: OWNER/REPO PR_NUMBER [--snapshot FILE]");
  }
  if (resolveId && resolveBot) {
    throw new Error("--resolve and --resolve-bot are mutually exclusive");
  }

  return {
    repo,
    pr,
    snapshotPath,
    checkpointPath,
    expectedHead,
    maxAgeSeconds,
    resolveId,
    resolveBot,
    workflow,
  };
}

export function bindSnapshotGateToController({ gate = {}, controller } = {}) {
  if (
    !controller ||
    controller.schemaVersion !== 1 ||
    controller.kind !== "github-delivery/workflow-controller"
  ) {
    throw new Error("invalid_workflow_controller_checkpoint");
  }
  if (gate.repo && gate.repo !== controller.repo) throw new Error("controller_repo_conflict");
  if (gate.pr && gate.pr !== controller.pr) throw new Error("controller_pr_conflict");
  if (gate.expectedHead && controller.headSha && gate.expectedHead !== controller.headSha) {
    throw new Error("controller_head_conflict");
  }
  const repo = gate.repo || controller.repo || null;
  const pr = gate.pr || controller.pr || null;
  if (!repo?.includes("/")) throw new Error("controller_repo_missing");
  if (!Number.isInteger(pr) || pr <= 0) throw new Error("controller_pr_missing");
  return {
    repo,
    pr,
    expectedHead: gate.expectedHead || controller.headSha || null,
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
  requireIntegrity = false,
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

  if (requireIntegrity || snapshot.integritySha256) {
    if (
      typeof snapshot.integritySha256 !== "string" ||
      !/^[0-9a-f]{64}$/i.test(snapshot.integritySha256)
    ) {
      reasons.push("snapshot_integrity_missing");
    } else {
      const actual = snapshotIntegritySha256(snapshot);
      if (actual !== snapshot.integritySha256.toLowerCase()) {
        reasons.push("snapshot_integrity_mismatch");
      }
      if (snapshot.snapshotId !== snapshot.integritySha256) {
        reasons.push("snapshot_id_integrity_mismatch");
      }
    }
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
