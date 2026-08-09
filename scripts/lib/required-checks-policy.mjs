function asAppId(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function descriptorKey(descriptor) {
  return `${descriptor.context}\u0000${descriptor.appId ?? "*"}`;
}

function addDescriptor(target, descriptor) {
  if (!descriptor?.context) return;
  const normalized = {
    context: String(descriptor.context),
    appId: asAppId(descriptor.appId),
    sources: [...new Set(descriptor.sources || [])],
  };
  const key = descriptorKey(normalized);
  const existing = target.get(key);
  if (existing) {
    existing.sources = [...new Set([...existing.sources, ...normalized.sources])];
  } else {
    target.set(key, normalized);
  }
}

export function normalizeRequiredChecks({
  classicRequiredStatusChecks = null,
  activeRules = [],
} = {}) {
  const descriptors = new Map();
  let strict = null;

  if (classicRequiredStatusChecks) {
    if (typeof classicRequiredStatusChecks.strict === "boolean") {
      strict = classicRequiredStatusChecks.strict;
    }
    const classicChecks = classicRequiredStatusChecks.checks || [];
    if (!classicChecks.length) {
      for (const context of classicRequiredStatusChecks.contexts || []) {
        addDescriptor(descriptors, {
          context,
          appId: null,
          sources: ["classic_context"],
        });
      }
    }
    for (const check of classicChecks) {
      if (typeof check === "string") {
        addDescriptor(descriptors, {
          context: check,
          appId: null,
          sources: ["classic_check"],
        });
      } else {
        addDescriptor(descriptors, {
          context: check?.context,
          appId: check?.app_id,
          sources: ["classic_check"],
        });
      }
    }
  }

  for (const rule of activeRules) {
    if (rule?.type !== "required_status_checks" || !rule.parameters) continue;
    const parameters = rule.parameters;
    const candidates =
      parameters.required_status_checks || parameters.checks || parameters.contexts || [];
    for (const check of candidates) {
      if (typeof check === "string") {
        addDescriptor(descriptors, {
          context: check,
          appId: null,
          sources: ["ruleset"],
        });
      } else {
        addDescriptor(descriptors, {
          context: check?.context,
          appId: check?.integration_id ?? check?.app_id,
          sources: ["ruleset"],
        });
      }
    }
    if (typeof parameters.strict_required_status_checks_policy === "boolean") {
      strict = Boolean(strict || parameters.strict_required_status_checks_policy);
    }
  }

  return {
    descriptors: [...descriptors.values()].sort((a, b) =>
      descriptorKey(a).localeCompare(descriptorKey(b)),
    ),
    strict,
  };
}

function normalizedSha(value) {
  const sha = String(value || "").trim().toLowerCase();
  return sha || null;
}

export function selectAuthoritativeCheckEvidence({
  headOid,
  testMergeOid = null,
  headCheckRuns = [],
  headStatuses = [],
  testMergeCheckRuns = [],
  testMergeStatuses = [],
  headEvidenceComplete = true,
  testMergeEvidenceComplete = true,
} = {}) {
  const head = normalizedSha(headOid);
  if (!head) {
    return {
      complete: false,
      sha: null,
      reason: "head_sha_missing",
      checkRuns: [],
      statuses: [],
      incompleteReasons: ["authoritative_check_sha_missing"],
    };
  }

  const testMerge = normalizedSha(testMergeOid);
  if (testMerge) {
    if (testMergeEvidenceComplete !== true) {
      return {
        complete: false,
        sha: testMerge,
        reason: "test_merge_evidence_incomplete",
        checkRuns: testMergeCheckRuns || [],
        statuses: testMergeStatuses || [],
        incompleteReasons: ["test_merge_check_evidence_incomplete"],
      };
    }
    const hasTestMergeEvidence =
      (testMergeCheckRuns || []).length > 0 || (testMergeStatuses || []).length > 0;
    if (hasTestMergeEvidence) {
      return {
        complete: true,
        sha: testMerge,
        reason: "test_merge_has_status",
        checkRuns: testMergeCheckRuns || [],
        statuses: testMergeStatuses || [],
        incompleteReasons: [],
      };
    }
  }

  if (headEvidenceComplete !== true) {
    return {
      complete: false,
      sha: head,
      reason: testMerge ? "test_merge_has_no_status" : "head_only",
      checkRuns: headCheckRuns || [],
      statuses: headStatuses || [],
      incompleteReasons: ["head_check_evidence_incomplete"],
    };
  }

  return {
    complete: true,
    sha: head,
    reason: testMerge ? "test_merge_has_no_status" : "head_only",
    checkRuns: headCheckRuns || [],
    statuses: headStatuses || [],
    incompleteReasons: [],
  };
}

function newestTimestamp(row) {
  const candidates = [
    row?.completed_at,
    row?.started_at,
    row?.created_at,
    row?.updated_at,
  ]
    .map((candidate) => Date.parse(candidate || ""))
    .filter(Number.isFinite);
  return candidates.length ? Math.max(...candidates) : Number(row?.id) || 0;
}

function checkRunState(row) {
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
  if (!conclusion) return status === "COMPLETED" ? "unknown" : "pending";
  return "unknown";
}

function statusState(row) {
  const state = String(row?.state || "").toUpperCase();
  if (state === "SUCCESS") return "pass";
  if (["FAILURE", "ERROR"].includes(state)) return "fail";
  if (state === "PENDING") return "pending";
  return "unknown";
}

export function latestLiveChecks({ checkRuns = [], statuses = [] } = {}) {
  const latestRuns = new Map();
  for (const row of checkRuns) {
    const name = row?.name;
    if (!name) continue;
    const appId = asAppId(row?.app?.id ?? row?.app?.databaseId ?? row?.app_id);
    const key = `${name}\u0000${appId ?? "unknown-app"}`;
    const existing = latestRuns.get(key);
    if (!existing || newestTimestamp(row) >= newestTimestamp(existing.raw)) {
      latestRuns.set(key, {
        type: "check_run",
        context: name,
        appId,
        producer: row?.app?.slug || row?.app?.name || (appId === null ? null : `app:${appId}`),
        gate: checkRunState(row),
        detailsUrl: row?.details_url || row?.html_url || null,
        raw: row,
      });
    }
  }

  const latestContexts = new Map();
  for (const row of statuses) {
    const context = row?.context;
    if (!context) continue;
    const existing = latestContexts.get(context);
    if (!existing || newestTimestamp(row) >= newestTimestamp(existing.raw)) {
      latestContexts.set(context, {
        type: "status_context",
        context,
        appId: null,
        producer: row?.creator?.login || null,
        gate: statusState(row),
        detailsUrl: row?.target_url || null,
        raw: row,
      });
    }
  }

  return [...latestRuns.values(), ...latestContexts.values()].sort((a, b) =>
    `${a.context}\u0000${a.type}\u0000${a.appId ?? ""}`.localeCompare(
      `${b.context}\u0000${b.type}\u0000${b.appId ?? ""}`,
    ),
  );
}

function combinedGate(matches) {
  if (!matches.length) return "missing";
  if (matches.some((row) => row.gate === "fail")) return "fail";
  if (matches.some((row) => row.gate === "pending")) return "pending";
  if (matches.some((row) => row.gate === "unknown")) return "unknown";
  return "pass";
}

export function evaluateRequiredChecks({
  descriptors = [],
  checkRuns = [],
  statuses = [],
  evidenceComplete = true,
  incompleteReasons = [],
  strict = null,
  mergeStateStatus = null,
} = {}) {
  const live = latestLiveChecks({ checkRuns, statuses });
  const configured = descriptors.map((descriptor) => {
    const sameContext = live.filter((row) => row.context === descriptor.context);
    const appMatches = sameContext.filter(
      (row) => row.type === "check_run" && row.appId === descriptor.appId,
    );
    const statusMatches = sameContext.filter((row) => row.type === "status_context");
    const sourceIdentityUnverifiable =
      descriptor.appId !== null &&
      appMatches.length === 0 &&
      statusMatches.length > 0;
    const matches =
      descriptor.appId === null
        ? sameContext
        : appMatches.length > 0
          ? [...appMatches, ...statusMatches]
          : appMatches;
    return {
      ...descriptor,
      gate: sourceIdentityUnverifiable ? "unknown" : combinedGate(matches),
      matches: matches.map(({ raw, ...row }) => row),
      producerCount: matches.length,
      ambiguous: descriptor.appId === null && matches.length > 1,
      sourceIdentityUnverifiable,
    };
  });

  const evaluated = configured.length
    ? configured
    : live.map(({ raw, ...row }) => ({
        context: row.context,
        appId: row.appId,
        sources: ["observed_unconfigured"],
        gate: row.gate,
        matches: [row],
        producerCount: 1,
        ambiguous: false,
      }));

  const blockers = [];
  const unknowns = [...incompleteReasons];

  if (strict === true && String(mergeStateStatus || "").toUpperCase() === "BEHIND") {
    blockers.push("strict_branch_out_of_date");
  }

  for (const row of evaluated) {
    const suffix = `${row.context}${row.appId === null ? "" : `@${row.appId}`}`;
    if (["fail", "pending"].includes(row.gate)) {
      blockers.push(`${row.gate}:${suffix}`);
    }
    if (row.gate === "missing") {
      if (evidenceComplete) blockers.push(`missing:${suffix}`);
      else unknowns.push(`missing_unconfirmed:${suffix}`);
    }
    if (row.gate === "unknown") {
      unknowns.push(`unknown:${suffix}`);
    }
  }

  if (!evidenceComplete) {
    unknowns.push("evidence_incomplete");
  }

  const uniqueBlockers = [...new Set(blockers)];
  const uniqueUnknowns = [...new Set(unknowns)];
  const decision = uniqueBlockers.length
    ? "blocked"
    : uniqueUnknowns.length
      ? "unknown"
      : "ready";

  return {
    complete: evidenceComplete && uniqueUnknowns.length === 0,
    decision,
    ready: decision === "ready",
    blocked: decision === "blocked",
    unknown: decision === "unknown",
    mode: configured.length ? "configured" : "observed",
    blockers: uniqueBlockers,
    unknowns: uniqueUnknowns,
    requiredStatus: configured,
    observedStatus: configured.length ? [] : evaluated,
    allLive: live.map(({ raw, ...row }) => row),
  };
}

export function evaluateRequiredCheckCompleteness({
  branchProtectionGraphqlComplete = false,
  matchingClassicRuleCount = 0,
  classicProtectionReadable = false,
  activeRulesComplete = false,
  checkRunsComplete = false,
  statusesComplete = false,
} = {}) {
  const reasons = [];
  if (!branchProtectionGraphqlComplete) reasons.push("classic_branch_rules_incomplete");
  if (matchingClassicRuleCount > 0 && !classicProtectionReadable) {
    reasons.push("effective_classic_protection_unreadable");
  }
  if (!activeRulesComplete) reasons.push("active_rules_incomplete");
  if (!checkRunsComplete) reasons.push("check_runs_incomplete");
  if (!statusesComplete) reasons.push("commit_statuses_incomplete");
  return { complete: reasons.length === 0, reasons };
}
