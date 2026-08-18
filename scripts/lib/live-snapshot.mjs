import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { enrichSnapshotWithBaseHealth } from "./base-health-live.mjs";
import { validateSnapshot } from "./snapshot-input.mjs";
import { boundedSpawnSync } from "./subprocess-policy.mjs";

const SNAPSHOT_COMMAND = fileURLToPath(
  new URL("../ship-gate-snapshot.mjs", import.meta.url),
);

function normalizedCheckRun(row = {}) {
  return {
    id: row.id ?? null,
    name: row.name ?? null,
    headSha: row.head_sha ?? row.headSha ?? null,
    status: row.status ?? null,
    conclusion: row.conclusion ?? null,
    appId: row.app?.id ?? row.app?.databaseId ?? row.app_id ?? null,
    checkSuiteId: row.check_suite?.id ?? row.checkSuite?.id ?? null,
    externalId: row.external_id ?? row.externalId ?? null,
    detailsUrl: row.details_url ?? row.detailsUrl ?? null,
    startedAt: row.started_at ?? row.startedAt ?? null,
    completedAt: row.completed_at ?? row.completedAt ?? null,
  };
}

function normalizedStatus(row = {}) {
  return {
    id: row.id ?? null,
    sha: row.sha ?? null,
    context: row.context ?? null,
    state: row.state ?? null,
    creatorId: row.creator?.id ?? null,
    creatorLogin: row.creator?.login ?? null,
    targetUrl: row.target_url ?? row.targetUrl ?? null,
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
  };
}

function stableRows(rows, normalize) {
  return (Array.isArray(rows) ? rows : [])
    .map(normalize)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

export function checkGenerationFingerprint({ checkRuns = [], statuses = [] } = {}) {
  const value = JSON.stringify({
    checkRuns: stableRows(checkRuns, normalizedCheckRun),
    statuses: stableRows(statuses, normalizedStatus),
  });
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function runJson(runner, args, errorCode) {
  const result = runner("gh", args, {
    encoding: "utf8",
    maxBuffer: 100 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new Error(`${errorCode}:${detail || `exit_${result.status}`}`);
  }
  try {
    return JSON.parse(result.stdout || "null");
  } catch {
    throw new Error(`${errorCode}:invalid_json`);
  }
}

export function captureCurrentCheckGeneration({
  repo,
  sha,
  runner = boundedSpawnSync,
} = {}) {
  if (!repo?.includes("/")) throw new Error("check_generation_repo_required");
  const commit = String(sha || "").trim().toLowerCase();
  if (!commit) throw new Error("check_generation_sha_required");

  const checkPages = runJson(
    runner,
    [
      "api",
      `repos/${repo}/commits/${commit}/check-runs?per_page=100`,
      "--paginate",
      "--slurp",
    ],
    "check_generation_check_runs_failed",
  );
  if (!Array.isArray(checkPages)) {
    throw new Error("check_generation_check_runs_invalid_payload");
  }
  const checkRuns = checkPages.flatMap((page) =>
    Array.isArray(page?.check_runs) ? page.check_runs : [],
  );
  const expectedCheckCount = checkPages.reduce((count, page) => {
    const value = Number(page?.total_count);
    return Number.isSafeInteger(value) && value >= 0 ? Math.max(count, value) : count;
  }, 0);
  if (expectedCheckCount !== checkRuns.length) {
    throw new Error(
      `check_generation_check_runs_incomplete: expected ${expectedCheckCount}, observed ${checkRuns.length}`,
    );
  }

  const statusPages = runJson(
    runner,
    [
      "api",
      `repos/${repo}/commits/${commit}/statuses?per_page=100`,
      "--paginate",
      "--slurp",
    ],
    "check_generation_statuses_failed",
  );
  if (!Array.isArray(statusPages)) {
    throw new Error("check_generation_statuses_invalid_payload");
  }
  const statuses = statusPages.flatMap((page) => (Array.isArray(page) ? page : []));

  return {
    sha: commit,
    checkRuns,
    statuses,
    fingerprint: checkGenerationFingerprint({ checkRuns, statuses }),
  };
}

export function assertFreshCheckGeneration(snapshot = {}, current = {}) {
  const expectedSha = String(
    snapshot?.evidence?.checks?.authoritative?.sha || snapshot?.headOid || "",
  ).toLowerCase();
  if (!expectedSha || String(current.sha || "").toLowerCase() !== expectedSha) {
    throw new Error(
      `live_snapshot_check_sha_mismatch: expected ${expectedSha || "missing"}, observed ${current.sha || "missing"}`,
    );
  }
  const expected = checkGenerationFingerprint({
    checkRuns: snapshot?.evidence?.checks?.checkRuns || [],
    statuses: snapshot?.evidence?.checks?.statuses || [],
  });
  const observed = current.fingerprint || checkGenerationFingerprint(current);
  if (expected !== observed) {
    throw new Error(
      `live_snapshot_check_generation_moved: expected ${expected}, observed ${observed}`,
    );
  }
  return expected;
}

export function captureLiveSnapshot({
  repo,
  pr,
  maxAgeSeconds = 300,
  expectedHead = null,
  runner = boundedSpawnSync,
} = {}) {
  const result = runner(
    process.execPath,
    [SNAPSHOT_COMMAND, repo, String(pr)],
    {
      encoding: "utf8",
      maxBuffer: 100 * 1024 * 1024,
    },
  );
  let snapshot;
  try {
    snapshot = JSON.parse(result.stdout || "null");
  } catch {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(detail || "Snapshot capture returned invalid JSON");
  }
  if (!snapshot) {
    const detail = (result.stderr || "").trim();
    throw new Error(detail || "Snapshot capture produced no evidence");
  }
  const validation = validateSnapshot({
    snapshot,
    repo,
    pr,
    expectedHead,
    maxAgeSeconds,
    requireComplete: false,
  });
  if (!validation.valid) {
    throw new Error(`Invalid live snapshot: ${validation.reasons.join(", ")}`);
  }
  const checkSha = snapshot?.evidence?.checks?.authoritative?.sha || snapshot.headOid;
  const current = captureCurrentCheckGeneration({ repo, sha: checkSha, runner });
  assertFreshCheckGeneration(snapshot, current);
  return enrichSnapshotWithBaseHealth(snapshot);
}
