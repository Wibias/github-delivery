import { boundedSpawnSync } from "./subprocess-policy.mjs";
import { collectPaginated } from "./github-pagination.mjs";
import { snapshotIntegritySha256 } from "./snapshot-schema.mjs";

function defaultRunGh(args) {
  const result = boundedSpawnSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    body: result.stdout || "",
    error: (result.stderr || result.stdout || "").trim() || null,
  };
}

function fetchCollection({
  runGh,
  path,
  label,
  unwrap = (payload) => payload,
}) {
  return collectPaginated({
    label,
    unwrap,
    fetchPage(page) {
      return runGh([
        "api",
        `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
      ]);
    },
  });
}

export function enrichSnapshotWithBaseHealth(
  snapshot,
  { runGh = defaultRunGh } = {},
) {
  const repo = snapshot?.repo || "";
  const [owner, name] = repo.split("/");
  const base = snapshot?.evidence?.pullRequest?.baseRefName;
  const refResponse = runGh([
    "api",
    `repos/${owner}/${name}/commits/${encodeURIComponent(base || "")}`,
  ]);
  let baseOid = null;
  let baseRefError = refResponse.error;
  if (refResponse.ok) {
    try {
      baseOid = JSON.parse(refResponse.body || "null")?.sha || null;
      if (!baseOid) baseRefError = "base commit response did not include sha";
      else baseRefError = null;
    } catch {
      baseRefError = "base commit response returned invalid JSON";
    }
  }

  const expectedBaseOid = String(
    snapshot?.evidence?.captureBoundary?.baseOid || "",
  ).toLowerCase();
  const observedBaseOid = String(baseOid || "").toLowerCase();
  if (
    expectedBaseOid &&
    observedBaseOid &&
    expectedBaseOid !== observedBaseOid
  ) {
    throw new Error(
      `base_health_boundary_mismatch: expected ${expectedBaseOid}, observed ${observedBaseOid}`,
    );
  }

  const unavailable = (label) => ({
    readable: false,
    complete: false,
    pages: 0,
    rows: [],
    error: baseRefError || `${label} unavailable without base SHA`,
  });
  const checkRuns = baseOid
    ? fetchCollection({
        runGh,
        path: `repos/${owner}/${name}/commits/${baseOid}/check-runs`,
        label: "base check runs",
        unwrap: (payload) => payload?.check_runs,
      })
    : unavailable("base check runs");
  const statuses = baseOid
    ? fetchCollection({
        runGh,
        path: `repos/${owner}/${name}/commits/${baseOid}/statuses`,
        label: "base commit statuses",
      })
    : unavailable("base commit statuses");

  const enriched = {
    ...snapshot,
    sources: {
      ...(snapshot?.sources || {}),
      baseRef: {
        required: false,
        readable: Boolean(baseOid),
        complete: Boolean(baseOid),
        error: baseRefError,
      },
      baseCheckRuns: {
        required: false,
        readable: checkRuns.readable,
        complete: checkRuns.complete,
        pages: checkRuns.pages,
        error: checkRuns.error,
      },
      baseStatuses: {
        required: false,
        readable: statuses.readable,
        complete: statuses.complete,
        pages: statuses.pages,
        error: statuses.error,
      },
    },
    evidence: {
      ...(snapshot?.evidence || {}),
      baseHealth: {
        baseRefName: base || null,
        baseOid,
        checks: {
          checkRuns: checkRuns.rows,
          statuses: statuses.rows,
        },
      },
    },
  };
  const integritySha256 = snapshotIntegritySha256(enriched);
  return {
    ...enriched,
    snapshotId: integritySha256,
    integritySha256,
  };
}
