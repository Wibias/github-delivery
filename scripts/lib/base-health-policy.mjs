function asAppId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function timestamp(row) {
  const values = [
    row?.completed_at,
    row?.started_at,
    row?.updated_at,
    row?.created_at,
  ]
    .map((value) => Date.parse(value || ""))
    .filter(Number.isFinite);
  return values.length ? Math.max(...values) : Number(row?.id) || 0;
}

function checkRunGate(row) {
  const status = String(row?.status || "").toUpperCase();
  const conclusion = String(row?.conclusion || "").toUpperCase();
  if (status && status !== "COMPLETED") return "pending";
  if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(conclusion)) return "pass";
  if (
    [
      "FAILURE",
      "CANCELLED",
      "TIMED_OUT",
      "ACTION_REQUIRED",
      "STARTUP_FAILURE",
      "STALE",
    ].includes(conclusion)
  ) {
    return "fail";
  }
  return conclusion ? "unknown" : status === "COMPLETED" ? "unknown" : "pending";
}

function statusGate(row) {
  const state = String(row?.state || "").toUpperCase();
  if (state === "SUCCESS") return "pass";
  if (["FAILURE", "ERROR"].includes(state)) return "fail";
  if (state === "PENDING") return "pending";
  return "unknown";
}

function liveChecks({ checkRuns = [], statuses = [] } = {}) {
  const latest = new Map();
  for (const row of checkRuns) {
    if (!row?.name) continue;
    const appId = asAppId(
      row?.app?.id ?? row?.app?.databaseId ?? row?.app_id,
    );
    const key = `check_run\u0000${row.name}\u0000${appId ?? "unknown-app"}`;
    const previous = latest.get(key);
    if (!previous || timestamp(row) >= timestamp(previous.raw)) {
      latest.set(key, {
        key,
        type: "check_run",
        context: row.name,
        appId,
        gate: checkRunGate(row),
        raw: row,
      });
    }
  }
  for (const row of statuses) {
    if (!row?.context) continue;
    const key = `status_context\u0000${row.context}`;
    const previous = latest.get(key);
    if (!previous || timestamp(row) >= timestamp(previous.raw)) {
      latest.set(key, {
        key,
        type: "status_context",
        context: row.context,
        appId: null,
        gate: statusGate(row),
        raw: row,
      });
    }
  }
  return [...latest.values()].map(({ raw, ...row }) => row);
}

function publicCheck(row) {
  return {
    key: row.key,
    type: row.type,
    context: row.context,
    appId: row.appId,
    gate: row.gate,
  };
}

export function evaluateBaseHealthSnapshot(snapshot) {
  const head = liveChecks(snapshot?.evidence?.checks || {});
  const headFailures = head.filter((row) => row.gate === "fail");
  const headUncertain = head.filter((row) =>
    ["pending", "unknown"].includes(row.gate),
  );
  const baseEvidence = snapshot?.evidence?.baseHealth || {};
  const baseSourcesComplete = [
    "baseRef",
    "baseCheckRuns",
    "baseStatuses",
  ].every((name) => snapshot?.sources?.[name]?.complete === true);
  const base = liveChecks(baseEvidence.checks || {});
  const baseByKey = new Map(base.map((row) => [row.key, row]));

  const sharedFailures = [];
  const prOnlyFailures = [];
  const unknownFailures = [];
  const perCheckOrigins = [];
  for (const failure of headFailures) {
    const baseRow = baseByKey.get(failure.key);
    const origin = !baseSourcesComplete
      ? "failure_origin_unknown"
      : baseRow?.gate === "fail"
        ? "base_preexisting"
        : baseRow && ["pending", "unknown"].includes(baseRow.gate)
          ? "failure_origin_unknown"
          : "pr_only";
    perCheckOrigins.push({
      key: failure.key,
      name: failure.context || failure.key,
      gate: failure.gate,
      origin,
      baseGate: baseRow?.gate || null,
      baseSourcesComplete,
      reason: !baseSourcesComplete
        ? "base evidence incomplete — cannot classify"
        : baseRow?.gate === "fail"
          ? "same check fails on base tip"
          : baseRow && ["pending", "unknown"].includes(baseRow.gate)
            ? "base check is not conclusive (pending/unknown)"
            : "base check passes — PR-introduced or infra (see ci-forensics)",
    });
    if (!baseSourcesComplete) {
      unknownFailures.push(publicCheck(failure));
    } else if (baseRow?.gate === "fail") {
      sharedFailures.push(publicCheck(failure));
    } else if (baseRow && ["pending", "unknown"].includes(baseRow.gate)) {
      unknownFailures.push(publicCheck(failure));
    } else {
      prOnlyFailures.push(publicCheck(failure));
    }
  }

  const baseOnlyFailures = base
    .filter(
      (row) =>
        row.gate === "fail" &&
        !headFailures.some((headRow) => headRow.key === row.key),
    )
    .map(publicCheck);
  const blockers = [
    ...prOnlyFailures.map((row) => `pr_only_failure:${row.key}`),
    ...sharedFailures.map((row) => `base_preexisting_failure:${row.key}`),
  ];
  const unknowns = [
    ...unknownFailures.map((row) => `failure_origin_unknown:${row.key}`),
    ...headUncertain.map((row) => `head_check_${row.gate}:${row.key}`),
  ];
  const decision = blockers.length
    ? "blocked"
    : unknowns.length
      ? "unknown"
      : "ready";

  return {
    schemaVersion: 1,
    snapshotId: snapshot?.snapshotId || null,
    repo: snapshot?.repo || null,
    pr: snapshot?.pr || null,
    headOid: snapshot?.headOid || null,
    baseOid: baseEvidence.baseOid || null,
    decision,
    ready: decision === "ready",
    blocked: decision === "blocked",
    unknown: decision === "unknown",
    complete: unknowns.length === 0,
    comparisonRequired: headFailures.length > 0,
    baseEvidenceComplete: baseSourcesComplete,
    blockers,
    unknowns,
    sharedFailures,
    prOnlyFailures,
    unknownFailures,
    perCheckOrigins,
    baseOnlyFailures,
    scopeRecommendation: prOnlyFailures.length
      ? "fix_in_pr"
      : sharedFailures.length
        ? "separate_follow_up"
        : unknownFailures.length
          ? "investigate"
          : "none",
    note: sharedFailures.length
      ? "The same failing check is present on the base tip. It may block merging, but it does not automatically expand this PR's implementation scope."
      : null,
  };
}
