import assert from "node:assert/strict";
import test from "node:test";

import {
  RULES_BOUNDARY_EVIDENCE_KIND,
  RULES_PLAN_MESSAGE,
  classifyRulesPlanFeatureUnavailable,
  parseGitHubApiFailure,
  rulesBoundaryFingerprint,
  validateRulesBoundaryEvidence,
} from "../../scripts/lib/rules-boundary.mjs";
import {
  snapshotBoundaryFingerprint,
  verifySnapshotBoundary,
} from "../../scripts/lib/snapshot-capture-payload.mjs";
import { evaluateRequiredChecksSnapshot } from "../../scripts/lib/snapshot-evaluators.mjs";

const DOCUMENTATION_URLS = {
  rulesets: "https://docs.github.com/rest/repos/rules#get-all-repository-rulesets",
  branchRules: "https://docs.github.com/rest/repos/rules#get-rules-for-a-branch",
  classicProtection:
    "https://docs.github.com/rest/branches/branch-protection#get-branch-protection",
};

function apiFailure({
  message = RULES_PLAN_MESSAGE,
  documentationUrl = DOCUMENTATION_URLS.rulesets,
  bodyStatus = 403,
  httpStatus = 403,
  errorMessage = message,
  body = undefined,
} = {}) {
  const payload =
    body === undefined
      ? {
          message,
          documentation_url: documentationUrl,
          status: bodyStatus,
        }
      : body;
  return {
    ok: false,
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
    error: `gh: ${errorMessage} (HTTP ${httpStatus})`,
  };
}

function planGated(endpointKey) {
  return apiFailure({ documentationUrl: DOCUMENTATION_URLS[endpointKey] });
}

function goodRepo(overrides = {}) {
  return { private: true, visibility: "private", ...overrides };
}

function goodBranch(overrides = {}) {
  return {
    protected: false,
    protection: {
      enabled: false,
      required_status_checks: {
        checks: [],
        contexts: [],
        enforcement_level: "off",
      },
    },
    ...overrides,
  };
}

function goodPolicy(overrides = {}) {
  return {
    readable: true,
    complete: true,
    branchProtectionRules: {
      pageInfo: { hasNextPage: false },
      nodes: [],
    },
    ...overrides,
  };
}

function classify({
  repo = goodRepo(),
  branch = goodBranch(),
  policy = goodPolicy(),
  probes = {},
} = {}) {
  return classifyRulesPlanFeatureUnavailable({
    repo,
    branch,
    policy,
    probes: {
      rulesets: planGated("rulesets"),
      branchRules: planGated("branchRules"),
      classicProtection: planGated("classicProtection"),
      ...probes,
    },
  });
}

function collection(rows = []) {
  return { readable: true, complete: true, pages: 1, rows, error: null };
}

const PR = { headRefOid: "head-a", baseRefName: "main" };
const BASE = { initialBaseOid: "base-a", finalBaseOid: "base-a" };

test("accepts the documented plan gate only with complete corroborating evidence", () => {
  const result = classify();
  assert.equal(result.determined, true);
  assert.equal(result.unavailable, true);
  assert.equal(result.reason, null);
  assert.equal(result.evidence.kind, RULES_BOUNDARY_EVIDENCE_KIND);
  assert.equal(result.evidence.message, RULES_PLAN_MESSAGE);
  assert.deepEqual(validateRulesBoundaryEvidence(result.evidence), {
    valid: true,
    reasons: [],
  });
  assert.equal(
    rulesBoundaryFingerprint(result.evidence),
    rulesBoundaryFingerprint(structuredClone(result.evidence)),
  );
});

test("rejects a permission-denied 403 even when another probe is plan-gated", () => {
  const result = classify({
    probes: {
      branchRules: apiFailure({
        message: "Resource not accessible by integration",
        documentationUrl: DOCUMENTATION_URLS.branchRules,
      }),
    },
  });
  assert.equal(result.unavailable, false);
  assert.ok(result.reasons.includes("branchRules_message_not_plan_gate"));
});

test("rejects transient and server failures", () => {
  for (const probe of [
    apiFailure({
      message: "Server Error",
      documentationUrl: DOCUMENTATION_URLS.rulesets,
      bodyStatus: 500,
      httpStatus: 500,
    }),
    apiFailure({
      message: "Service unavailable",
      documentationUrl: DOCUMENTATION_URLS.rulesets,
      bodyStatus: 503,
      httpStatus: 503,
    }),
  ]) {
    const result = classify({ probes: { rulesets: probe } });
    assert.equal(result.unavailable, false);
    assert.match(result.reasons[0], /rulesets_http_5/);
  }
});

test("rejects ambiguous mixed probe outcomes", () => {
  for (const probe of [
    { ok: true, body: "[]", error: null },
    apiFailure({
      message: "Not Found",
      documentationUrl: DOCUMENTATION_URLS.rulesets,
      bodyStatus: 404,
      httpStatus: 404,
    }),
  ]) {
    const result = classify({ probes: { rulesets: probe } });
    assert.equal(result.unavailable, false);
    assert.ok(
      result.reasons.includes("rulesets_probe_succeeded") ||
        result.reasons.includes("rulesets_http_404"),
    );
  }
});

test("rejects message-spoof variants", () => {
  const variants = [
    { message: `${RULES_PLAN_MESSAGE} (see docs)` },
    { message: `Warning: ${RULES_PLAN_MESSAGE}` },
    { message: RULES_PLAN_MESSAGE.toLowerCase() },
    { message: RULES_PLAN_MESSAGE.replace(/\.$/, "") },
    { message: RULES_PLAN_MESSAGE.replace("repository", "repo") },
  ];
  for (const variant of variants) {
    const result = classify({
      probes: {
        rulesets: apiFailure({
          ...variant,
          documentationUrl: DOCUMENTATION_URLS.rulesets,
        }),
      },
    });
    assert.equal(result.unavailable, false, JSON.stringify(variant));
    assert.ok(result.reasons.includes("rulesets_message_not_plan_gate"));
  }

  const documentationVariants = [
    `${DOCUMENTATION_URLS.rulesets}?mine=1`,
    "https://docs.github.com/rest/repos/rules#get-rules-for-a-branch",
    "https://docs.github.com/rest/repos/rules",
  ];
  for (const documentationUrl of documentationVariants) {
    const result = classify({
      probes: { rulesets: apiFailure({ documentationUrl }) },
    });
    assert.equal(result.unavailable, false, documentationUrl);
    assert.ok(result.reasons.includes("rulesets_documentation_url_mismatch"));
  }
});

test("rejects inconsistent or malformed HTTP failure payloads", () => {
  const bodyStatusMismatch = apiFailure({
    documentationUrl: DOCUMENTATION_URLS.rulesets,
    bodyStatus: 500,
    httpStatus: 403,
  });
  assert.equal(
    parseGitHubApiFailure(bodyStatusMismatch).reason,
    "error_payload_status_mismatch",
  );
  assert.equal(
    classify({ probes: { rulesets: bodyStatusMismatch } }).unavailable,
    false,
  );

  const duplicateStatus = {
    ok: false,
    body: JSON.stringify({
      message: RULES_PLAN_MESSAGE,
      documentation_url: DOCUMENTATION_URLS.rulesets,
      status: 403,
    }),
    error: `gh: ${RULES_PLAN_MESSAGE} (HTTP 403) (HTTP 500)`,
  };
  assert.equal(
    parseGitHubApiFailure(duplicateStatus).reason,
    "http_status_ambiguous",
  );

  const textMessageMismatch = {
    ok: false,
    body: JSON.stringify({
      message: RULES_PLAN_MESSAGE,
      documentation_url: DOCUMENTATION_URLS.rulesets,
      status: 403,
    }),
    error: "gh: Upgrade to GitHub Pro to use repository rules (HTTP 403)",
  };
  assert.equal(
    parseGitHubApiFailure(textMessageMismatch).reason,
    "error_text_message_mismatch",
  );

  for (const body of ["not-json", "[]", "null"]) {
    const response = {
      ok: false,
      body,
      error: `gh: ${RULES_PLAN_MESSAGE} (HTTP 403)`,
    };
    assert.equal(
      classify({ probes: { rulesets: response } }).unavailable,
      false,
    );
  }
});

test("rejects a plan-gated response when the repository is not confirmed private", () => {
  for (const repo of [
    goodRepo({ private: false, visibility: "public" }),
    goodRepo({ visibility: "internal" }),
    goodRepo({ private: "true" }),
    null,
  ]) {
    const result = classify({ repo });
    assert.equal(result.unavailable, false);
    assert.ok(result.reasons.includes("repository_not_confirmed_private"));
  }
});

test("rejects any branch state that could still enforce classic protection", () => {
  const variants = [
    goodBranch({ protected: true }),
    {
      protected: false,
      protection: {
        enabled: true,
        required_status_checks: {
          checks: [],
          contexts: [],
          enforcement_level: "off",
        },
      },
    },
    {
      protected: false,
      protection: {
        enabled: false,
        required_status_checks: {
          checks: [],
          contexts: [],
          enforcement_level: "all",
        },
      },
    },
    {
      protected: false,
      protection: {
        enabled: false,
        required_status_checks: {
          checks: ["CI"],
          contexts: [],
          enforcement_level: "off",
        },
      },
    },
    {
      protected: false,
      protection: {
        enabled: false,
        required_status_checks: {
          checks: [],
          contexts: ["CI"],
          enforcement_level: "off",
        },
      },
    },
    { protected: false },
  ];
  for (const branch of variants) {
    const result = classify({ branch });
    assert.equal(result.unavailable, false, JSON.stringify(branch));
    assert.ok(result.reasons.includes("branch_not_confirmed_unprotected"));
  }
});

test("rejects policy evidence that still contains a classic rule", () => {
  const variants = [
    goodPolicy({
      branchProtectionRules: {
        pageInfo: { hasNextPage: false },
        nodes: [{ pattern: "main" }],
      },
    }),
    goodPolicy({ complete: false }),
    goodPolicy({ readable: false }),
    goodPolicy({
      branchProtectionRules: {
        pageInfo: { hasNextPage: true },
        nodes: [],
      },
    }),
  ];
  for (const policy of variants) {
    const result = classify({ policy });
    assert.equal(result.unavailable, false);
    assert.ok(result.reasons.includes("classic_rules_not_confirmed_empty"));
  }
});

test("boundary evidence validation rejects tampered fields", () => {
  const evidence = classify().evidence;
  const tampered = [
    { ...evidence, message: `${RULES_PLAN_MESSAGE} extra` },
    { ...evidence, repo: { private: true, visibility: "public" } },
    {
      ...evidence,
      branch: { ...evidence.branch, requiredStatusCheckCount: 1 },
    },
    { ...evidence, policy: { ...evidence.policy, branchProtectionRuleCount: 1 } },
    {
      ...evidence,
      endpoints: {
        ...evidence.endpoints,
        rulesets: { status: 403, documentationUrl: "https://example.test/rules" },
      },
    },
  ];
  for (const value of tampered) {
    assert.equal(validateRulesBoundaryEvidence(value).valid, false);
  }
  assert.equal(validateRulesBoundaryEvidence(null).valid, false);
});

test("snapshot boundary accepts one unchanged plan-feature boundary", () => {
  const boundary = classify();
  const result = verifySnapshotBoundary(PR, PR, {
    ...BASE,
    initialRules: collection(),
    finalRules: collection(),
    initialRulesBoundary: boundary,
    finalRulesBoundary: boundary,
  });
  assert.equal(result.rulesFingerprint, snapshotBoundaryFingerprint([]));
  assert.equal(
    result.rulesBoundaryFingerprint,
    rulesBoundaryFingerprint(boundary.evidence),
  );
});

test("snapshot boundary refuses a boundary that stopped being proven", () => {
  const boundary = classify();
  const degraded = classify({ repo: goodRepo({ private: false, visibility: "public" }) });
  assert.throws(
    () =>
      verifySnapshotBoundary(PR, PR, {
        ...BASE,
        initialRules: collection(),
        finalRules: collection(),
        initialRulesBoundary: boundary,
        finalRulesBoundary: degraded,
      }),
    /snapshot_rules_boundary_incomplete/,
  );
  assert.throws(
    () =>
      verifySnapshotBoundary(PR, PR, {
        ...BASE,
        initialRules: collection(),
        finalRules: collection(),
        initialRulesBoundary: boundary,
        finalRulesBoundary: null,
      }),
    /snapshot_rules_boundary_incomplete/,
  );
});

test("snapshot boundary rejects changed boundary evidence", () => {
  const boundary = classify();
  const changed = {
    ...boundary,
    evidence: { ...boundary.evidence, observerNote: "changed" },
  };
  assert.equal(validateRulesBoundaryEvidence(changed.evidence).valid, true);
  assert.throws(
    () =>
      verifySnapshotBoundary(PR, PR, {
        ...BASE,
        initialRules: collection(),
        finalRules: collection(),
        initialRulesBoundary: boundary,
        finalRulesBoundary: changed,
      }),
    /snapshot_rules_moved:rules_boundary_evidence/,
  );
});

function source(required = true) {
  return { required, readable: true, complete: true, error: null };
}

function evaluatorSnapshot() {
  return {
    schemaVersion: 1,
    kind: "github-delivery/evidence-snapshot",
    snapshotId: "snap",
    capturedAt: "2026-11-08T03:00:00.000Z",
    repo: "Wibias/streamer-content",
    pr: 1,
    headOid: "head-a",
    complete: true,
    incompleteReasons: [],
    sources: {
      pr: source(),
      changedFiles: source(),
      activeRules: source(),
      checkRuns: source(),
      statuses: source(),
      issueComments: source(),
      reviewComments: source(),
      reviews: source(),
      reviewThreads: source(),
      branchProtection: source(false),
      codeowners: source(false),
      codeownersErrors: source(false),
      policyGraphql: source(),
      workflowCoverage: source(),
      viewer: source(),
    },
    evidence: {
      pullRequest: {
        number: 1,
        url: "https://github.com/Wibias/streamer-content/pull/1",
        baseRefName: "main",
        headRefOid: "head-a",
        mergeStateStatus: "CLEAN",
        mergeable: "MERGEABLE",
        reviewDecision: "APPROVED",
        isDraft: false,
        reviewRequests: [],
        commits: [],
      },
      changedFiles: [],
      branchProtection: null,
      activeRules: [],
      checks: {
        checkRuns: [],
        statuses: [],
        authoritative: {
          sha: "head-a",
          reason: "head_only",
          complete: true,
          incompleteReasons: [],
        },
      },
      feedback: {
        issueComments: [],
        reviewComments: [],
        reviews: [],
        reviewThreads: [],
      },
      codeowners: { path: null, text: null, errors: [] },
      policy: {
        branchProtectionRules: {
          pageInfo: { hasNextPage: false },
          nodes: [],
        },
        latestOpinionatedReviews: {
          pageInfo: { hasNextPage: false },
          nodes: [],
        },
        mergeQueue: { enabled: false, inQueue: false, entry: null },
      },
      workflowCoverage: {
        complete: true,
        scannedRef: "main",
        workflowFiles: 0,
        hasPullRequestTrigger: null,
        hasMergeGroupTrigger: null,
        warning: null,
      },
      viewer: { login: "Wibias" },
    },
  };
}

function featureUnavailableSnapshot() {
  const boundary = classify();
  const value = evaluatorSnapshot();
  value.sources.activeRules = {
    ...source(),
    featureUnavailable: true,
  };
  value.sources.branchProtection = {
    ...source(false),
    featureUnavailable: true,
  };
  value.evidence.rulesBoundary = {
    mode: "plan_feature_unavailable",
    reason: null,
    evidence: boundary.evidence,
  };
  return value;
}

test("required checks stay ready with valid plan-feature evidence", () => {
  const result = evaluateRequiredChecksSnapshot(featureUnavailableSnapshot());
  assert.equal(result.complete, true);
  assert.equal(result.decision, "ready");
});

test("feature-unavailable evidence without a valid boundary stays unknown", () => {
  for (const evidence of [
    null,
    { mode: "plan_feature_unavailable", evidence: null },
    {
      mode: "plan_feature_unavailable",
      evidence: {
        ...classify().evidence,
        endpoints: {
          ...classify().evidence.endpoints,
          branchRules: {
            status: 403,
            documentationUrl: "https://docs.github.com/rest/repos/rules#wrong",
          },
        },
      },
    },
  ]) {
    const value = featureUnavailableSnapshot();
    value.evidence.rulesBoundary = evidence;
    const result = evaluateRequiredChecksSnapshot(value);
    assert.equal(result.decision, "unknown");
    assert.ok(result.unknowns.includes("active_rules_incomplete"));
  }
});

test("existing rules and required checks are still enforced", () => {
  const value = evaluatorSnapshot();
  value.evidence.activeRules = [
    {
      type: "required_status_checks",
      parameters: {
        required_status_checks: [{ context: "CI", integration_id: 7 }],
      },
    },
  ];
  const result = evaluateRequiredChecksSnapshot(value);
  assert.equal(result.decision, "blocked");
  assert.ok(result.blockers.includes("missing:CI@7"));

  const inconsistent = featureUnavailableSnapshot();
  inconsistent.evidence.activeRules = value.evidence.activeRules;
  const enforced = evaluateRequiredChecksSnapshot(inconsistent);
  assert.equal(enforced.decision, "blocked");
  assert.ok(enforced.blockers.includes("missing:CI@7"));
});
