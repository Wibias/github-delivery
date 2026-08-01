export const DEFAULT_EXPECTED_CHECKS = Object.freeze([
  { workflow: "CI", name: "Node 20 / ubuntu-latest" },
  { workflow: "CI", name: "Node 20 / windows-latest" },
  { workflow: "CI", name: "Node 20 / macos-latest" },
  { workflow: "CI", name: "Node 22 / ubuntu-latest" },
  { workflow: "CI", name: "Node 22 / windows-latest" },
  { workflow: "CI", name: "Node 22 / macos-latest" },
  { workflow: "Dependency Review" },
  { workflow: "CodeQL" },
]);

export const DEFAULT_EXPECTED_WORKFLOWS = Object.freeze([
  "CI",
  "Dependency Review",
  "CodeQL",
]);

const APPROVAL_STATES = new Set(["action_required", "waiting"]);
const FAILED_BUCKETS = new Set(["fail", "cancel", "skipping"]);
const FAILED_STATES = new Set([
  "ACTION_REQUIRED",
  "CANCELLED",
  "FAILURE",
  "SKIPPED",
  "STALE",
  "TIMED_OUT",
]);
const PENDING_BUCKETS = new Set(["pending"]);
const PENDING_STATES = new Set(["EXPECTED", "IN_PROGRESS", "PENDING", "QUEUED", "REQUESTED", "WAITING"]);

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function checkLabel(check) {
  return `${check.workflow || "unknown workflow"} / ${check.name || "unnamed check"}`;
}

function normalizeCheck(check) {
  return {
    workflow: String(check?.workflow || check?.workflowName || ""),
    name: String(check?.name || check?.context || ""),
    bucket: String(check?.bucket || "").toLowerCase(),
    state: String(check?.state || check?.conclusion || check?.status || "").toUpperCase(),
    event: check?.event || null,
    link: check?.link || check?.detailsUrl || check?.url || null,
  };
}

function normalizeRun(run) {
  return {
    name: String(run?.name || run?.workflowName || ""),
    status: String(run?.status || "").toLowerCase(),
    conclusion: String(run?.conclusion || "").toLowerCase(),
    url: run?.url || run?.html_url || null,
  };
}

function matchesExpected(check, expected) {
  if (check.workflow !== expected.workflow) return false;
  return expected.name ? check.name === expected.name : true;
}

function evaluation({ state, code, message, checks, expectedChecks, runs, missingChecks = [], pendingChecks = [], failedChecks = [] }) {
  const observedWorkflows = uniqueSorted(checks.map((check) => check.workflow));
  const missingWorkflows = DEFAULT_EXPECTED_WORKFLOWS.filter((workflow) => !observedWorkflows.includes(workflow));
  return {
    state,
    code,
    message,
    missingChecks,
    missingWorkflows,
    pendingChecks,
    failedChecks,
    approvalRuns: runs.filter((run) => APPROVAL_STATES.has(run.status) || APPROVAL_STATES.has(run.conclusion)),
    summary: state === "ready" ? {
      conclusion: "success",
      count: checks.length,
      expectedWorkflows: [...DEFAULT_EXPECTED_WORKFLOWS],
      expectedChecks: expectedChecks.map(checkLabel),
      observedWorkflows,
      checks,
    } : null,
  };
}

export function evaluateFixtureChecks({ checks = [], runs = [], expectedChecks = DEFAULT_EXPECTED_CHECKS } = {}) {
  const normalizedChecks = checks.map(normalizeCheck);
  const normalizedRuns = runs.map(normalizeRun);
  const approvalRuns = normalizedRuns.filter((run) => APPROVAL_STATES.has(run.status) || APPROVAL_STATES.has(run.conclusion));

  if (approvalRuns.length) {
    return evaluation({
      state: "waiting",
      code: "fixture_workflows_approval_required",
      message: "Fixture PR workflows require approval. Open the fixture PR and choose ‘Approve workflows to run’ before the timeout.",
      checks: normalizedChecks,
      expectedChecks,
      runs: normalizedRuns,
    });
  }

  if (!normalizedChecks.length) {
    return evaluation({
      state: "waiting",
      code: "fixture_checks_not_observed",
      message: "No PR checks have been observed yet.",
      checks: normalizedChecks,
      expectedChecks,
      runs: normalizedRuns,
    });
  }

  const failedChecks = normalizedChecks
    .filter((check) => FAILED_BUCKETS.has(check.bucket) || FAILED_STATES.has(check.state))
    .map(checkLabel)
    .sort((a, b) => a.localeCompare(b));
  if (failedChecks.length) {
    return evaluation({
      state: "blocked",
      code: "fixture_checks_failed",
      message: `Fixture PR checks failed: ${failedChecks.join(", ")}`,
      checks: normalizedChecks,
      expectedChecks,
      runs: normalizedRuns,
      failedChecks,
    });
  }

  const missingChecks = expectedChecks
    .filter((expected) => !normalizedChecks.some((check) => matchesExpected(check, expected)))
    .map(checkLabel);
  if (missingChecks.length) {
    return evaluation({
      state: "waiting",
      code: "fixture_required_checks_missing",
      message: `Required fixture checks have not appeared: ${missingChecks.join(", ")}`,
      checks: normalizedChecks,
      expectedChecks,
      runs: normalizedRuns,
      missingChecks,
    });
  }

  const pendingChecks = normalizedChecks
    .filter((check) => PENDING_BUCKETS.has(check.bucket) || PENDING_STATES.has(check.state) || (!check.bucket && !check.state))
    .map(checkLabel)
    .sort((a, b) => a.localeCompare(b));
  if (pendingChecks.length) {
    return evaluation({
      state: "waiting",
      code: "fixture_checks_pending",
      message: `Fixture PR checks are still pending: ${pendingChecks.join(", ")}`,
      checks: normalizedChecks,
      expectedChecks,
      runs: normalizedRuns,
      pendingChecks,
    });
  }

  return evaluation({
    state: "ready",
    code: "fixture_checks_satisfied",
    message: "All required fixture checks passed.",
    checks: normalizedChecks,
    expectedChecks,
    runs: normalizedRuns,
  });
}

function fixtureCheckError(result, timeout = false) {
  const error = new Error(timeout ? `${result.code}: ${result.message} Timed out waiting for complete check evidence.` : `${result.code}: ${result.message}`);
  error.code = result.code;
  error.details = result;
  return error;
}

export async function waitForExpectedChecks({
  readChecks,
  readRuns = async () => [],
  expectedChecks = DEFAULT_EXPECTED_CHECKS,
  timeoutMs = 15 * 60 * 1000,
  intervalMs = 10 * 1000,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onProgress = () => {},
} = {}) {
  if (typeof readChecks !== "function") throw new Error("readChecks must be a function");
  const deadline = now() + timeoutMs;
  let previousCode = null;
  let last = evaluateFixtureChecks({ expectedChecks });

  while (true) {
    const [checks, runs] = await Promise.all([readChecks(), readRuns()]);
    last = evaluateFixtureChecks({ checks, runs, expectedChecks });
    if (last.code !== previousCode) {
      onProgress(last);
      previousCode = last.code;
    }
    if (last.state === "ready") return last.summary;
    if (last.state === "blocked") throw fixtureCheckError(last, false);
    if (now() >= deadline) throw fixtureCheckError(last, true);
    await sleep(Math.min(intervalMs, Math.max(0, deadline - now())));
  }
}
