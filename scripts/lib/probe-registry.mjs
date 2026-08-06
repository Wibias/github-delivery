// Probe registry: the single source of truth that binds a diff-shape trigger
// (regex on added lines / changed paths) to a named review probe and to the
// regression assertions that probe must satisfy.
//
// The scope engine (review-scope.mjs) reads `triggers` to emit `requiredProbes`
// deterministically. The eval validator (eval-contracts.mjs) uses this table to
// (1) execute scope-case fixtures and assert the exact probe set, and (2) verify
// that every `<!-- assertion: ... -->` marker in the reference docs sits in a
// doc that also carries that probe's `<!-- probe: ... -->` tag.
//
// Rules:
// - `axis` is "bug" or "security".
// - `lens` (bug) / `surface` (security) must be an id the scope engine already
//   emits, so the probe rides on the existing deterministic lens/surface routing.
// - `triggers` are regexes matched against added lines and changed paths. Keep
//   them general (repo-agnostic classes), never repo-specific identifiers.
// - `assertions` must equal the `<!-- assertion: ... -->` ids inside the probe's
//   documented block; the validator enforces this cross-product.

export const PROBE_REGISTRY = [
  // --- bug axis ---
  {
    id: "api-cli-wiring",
    axis: "bug",
    lens: "api_cli_wiring",
    triggers: [
      /--[a-z][a-z0-9-]*\b/i, // new CLI flag
      /\bargparse|commander|yargs|clap|optparse\b/i,
      /\.shift\(\)|process\.argv|unknown routing profile/i,
    ],
    assertions: ["wiring-trace-required", "operator-smoke-required", "green-tests-not-enough"],
  },
  {
    id: "input-shape-evidence-semantics",
    axis: "bug",
    lens: "input_shape",
    triggers: [
      /\bscanner\b|\bclassif|\bparseRequest\b|\bparseBody\b|content\[\d*\]\.content|messages\[\d*\]\.content|nested|parallelToolCalls|unknownEvidence/i,
      /\bevidence\b.*\bderiv|deriv.*\bevidence|\bcapabilit|\beligib|localOnly|remoteAllowed|supported|unsupported/i,
      /\bauthMode\b|registry\s*backfill|\?\?\s*\{/,
      /\bestimatedUsd|\blimitUsd|maxEstimatedCostUsd|quotaScore|headroom\b/i,
    ],
    assertions: [
      "real-shape-required",
      "unknown-not-false",
      "nested-source-evidence",
      "unknown-scoring-neutral",
      "absent-config-unknown-not-false",
      "no-default-object-cast",
      "evidence-mirrors-router-backfill",
      "hard-requirement-normalized-value",
      "absent-vs-zero-vs-malformed",
      "raw-check-agrees-with-score",
      "hard-limit-from-policy",
      "caller-evidence-not-truth",
      "profile-limit-stamped-trace",
      "reject-misplaced-flag",
      "usage-on-dash-id",
      "both-show-and-dryrun",
    ],
  },
  {
    id: "determinism-clocks-budgets",
    axis: "bug",
    lens: "determinism_metrics",
    triggers: [
      /\bDate\.now\(\)|new Date|Date\.\w+\(\)/i,
      /\bLIMIT\b|\bmaxRows\b/i,
      /\bJSON\.stringify\b.*\.length|\b16 KiB\b|\bbudget\b|\btruncated\b/i,
      /\baggregat|\bevery X or Y\b|\ball X or all Y\b/i,
    ],
    assertions: ["one-decision-one-clock", "filter-before-limit", "aggregate-union-required", "byte-budget-required"],
  },
  {
    id: "recursion-termination",
    axis: "bug",
    lens: "edge_cases",
    triggers: [
      /\bresolv|\balias\b|\brouteModel\b|\brecursi|\bstack overflow\b/i,
      /\blookup\b/i,
    ],
    assertions: ["recursion-termination-required", "alias-namespace-shadow"],
  },
  {
    id: "cli-payload-completeness",
    axis: "bug",
    lens: "api_cli_wiring",
    triggers: [
      /unknownEvidence\b.*\bexclude\b|\bcandidate evidence\b|\bdry-run\b.*\bpayload\b/i,
      /\bempty candidate\b|\bempty list\b.*\bevaluator/i,
    ],
    assertions: ["cli-payload-completeness"],
  },
  {
    id: "hot-path-scale",
    axis: "bug",
    lens: "hot_path_scale",
    triggers: [
      /\breadFileSync\b|\breadFile\b/i,
      /\bper-candidate\b|\bper-row\b|\bper-request\b|\bO\(ledger\)\b/i,
      /\bidentity\b.*\bsize\b|\bidentity\b.*\bmtime\b|\btail-ingest\b|\brebuild\b/i,
    ],
    assertions: ["hot-path-scale-required"],
  },
  {
    id: "malformed-input-robustness",
    axis: "bug",
    lens: "malformed_input_robustness",
    triggers: [
      /\bJSON\.parse\b|\bdecodeURIComponent\b/i,
      /\bSQLite\b|\bHealthSample\b|\bas\s+\w+\[\]\b/i,
      /\bduration_ms\b/i,
    ],
    assertions: ["malformed-input-robust", "db-result-cast-boundary", "non-finite-excluded", "null-not-number"],
  },
  {
    id: "lock-error-propagation",
    axis: "bug",
    lens: "error_propagation",
    triggers: [
      /\bfinally\b|\bclose\(\)\b|\bunlock\b|\bdispose\b/i,
      /\bmutation\b|\bCAS\b|\bcompare-and-swap\b/i,
      /\b409\b|\b503\b|\bretryable\b|\bSQLITE_BUSY\b/i,
      /\bdetached\b|\bbackground\b/i,
    ],
    assertions: [
      "complementary-must-probe",
      "typed-catch-detached",
      "finally-not-replace-error",
      "lock-contention-409-503",
      "deterministic-lock-regressions",
    ],
  },
  {
    id: "test-honesty",
    axis: "bug",
    lens: "evidence_semantics",
    triggers: [
      /\.(?:test|spec)\.[cm]?[jt]sx?$/i, // changed test file
      /setTimeout\(|setInterval\(|await\s+sleep\(|new Promise\(resolve\s*=>\s*setTimeout/i, // fixed sleeps
      /expect\([^)]*\)\.(?:toHaveLength|toContain|toEqual|toMatchObject|toHaveClass|querySelector|getBy)/i, // vacuity-prone assertions
    ],
    assertions: [
      "non-vacuous-assertions",
      "no-fixed-sleeps",
      "exact-selector-required",
      "order-asserted-not-membership",
    ],
  },
  {
    id: "ui-accessibility",
    axis: "bug",
    lens: "ui_accessibility",
    triggers: [
      /\.tsx$|\.jsx$|\.vue$|\.svelte$/i, // UI component files
      /\baria-|\brole=|\balt=|\btabIndex|\bonKeyDown|\bhtmlFor/i,
    ],
    assertions: [
      "accessible-names-unique",
      "keyboard-operable",
      "focus-managed",
      "labels-bound",
    ],
  },
  // --- security axis ---
  {
    id: "credential-transport",
    axis: "security",
    surface: "ssrf_outbound",
    triggers: [
      /\bbaseUrl\b|\bbase_url\b|\bnew URL\(/i,
      /\bAuthorization\b|\bBearer\b|\bapi[_-]?key\b|\baccess[_-]?token\b/i,
      /https?:\/\//i,
      /\bOAuth\b|\btoken\s*refresh\b|\bonManualCodeInput\b|\bOAuthCallbackFlow\b/i,
    ],
    assertions: [
      "oauth-token-no-cleartext",
      "baseurl-https-only-credential-provider",
      "shared-http-validator-not-enough",
      "sibling-providers-same-rule",
    ],
  },
  {
    id: "secrets-scan",
    axis: "security",
    surface: "secrets_config",
    triggers: [
      /\bsecret\b|\bapi[_-]?key\b|\bprocess\.env\b|\bos\.environ\b|\bvault\b|scan_secrets|\.env\b/i,
    ],
    assertions: ["secrets-scan"],
  },
  {
    id: "removed-controls",
    axis: "security",
    surface: "authz",
    mode: "removed",
    triggers: [
      /\brequireAuth\b|\brequireAdmin\b|\bcanAccess\b|\bmiddleware\b|\bcsrf\b|\bpermission\b/i,
    ],
    assertions: ["removed-controls-leads"],
  },
];

// Map from assertion id -> probe id, so the validator can find which probe a
// marker belongs to.
export const ASSERTION_TO_PROBE = new Map(
  PROBE_REGISTRY.flatMap((probe) => probe.assertions.map((assertion) => [assertion, probe.id])),
);

// Map from probe id -> probe.
export const PROBE_BY_ID = new Map(PROBE_REGISTRY.map((probe) => [probe.id, probe]));

// Every probe must declare a lens (bug) or surface (security) that the scope
// engine emits, and at least one trigger and assertion.
export function validateProbeRegistry(knownLensIds, knownSurfaceIds) {
  const errors = [];
  for (const probe of PROBE_REGISTRY) {
    if (probe.axis === "bug" && !knownLensIds.includes(probe.lens)) {
      errors.push({ code: "probe_unknown_lens", probe: probe.id, lens: probe.lens });
    }
    if (probe.axis === "security" && !knownSurfaceIds.includes(probe.surface)) {
      errors.push({ code: "probe_unknown_surface", probe: probe.id, surface: probe.surface });
    }
    if (!Array.isArray(probe.triggers) || probe.triggers.length === 0) {
      errors.push({ code: "probe_no_triggers", probe: probe.id });
    }
    if (!Array.isArray(probe.assertions) || probe.assertions.length === 0) {
      errors.push({ code: "probe_no_assertions", probe: probe.id });
    }
  }
  return errors;
}
