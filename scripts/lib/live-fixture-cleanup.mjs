import { assertSafeFixturePlan, buildFixturePlan } from "./live-github-fixture.mjs";

function normalizeState(value) {
  return String(value || "").toUpperCase();
}

function failure(action, error) {
  return {
    action,
    message: String(error?.message || error),
  };
}

export function buildInterruptedReceipt(plan, {
  code = "fixture_lifecycle_interrupted",
  message = "The lifecycle process ended before writing a complete receipt.",
  events = [],
  checks = null,
} = {}) {
  assertSafeFixturePlan(plan);
  return {
    schemaVersion: 1,
    kind: "github-delivery/live-fixture-receipt",
    repo: plan.repo,
    runId: plan.runId,
    disposition: plan.disposition,
    passed: false,
    problems: [`${code}: ${message}`],
    failure: { code, message },
    eventCount: Array.isArray(events) ? events.length : 0,
    checks,
    events: Array.isArray(events) ? events : [],
  };
}

export async function cleanupFixtureResources(adapter, options) {
  const plan = buildFixturePlan(options);
  assertSafeFixturePlan(plan);
  const actions = [];
  const failures = [];
  let pr = null;
  let issue = null;
  let branchExists = false;

  try {
    pr = await adapter.findPr(plan);
  } catch (error) {
    failures.push(failure("find_pr", error));
  }
  try {
    issue = await adapter.findIssue(plan);
  } catch (error) {
    failures.push(failure("find_issue", error));
  }
  try {
    branchExists = await adapter.branchExists(plan);
  } catch (error) {
    failures.push(failure("find_branch", error));
  }

  if (pr && normalizeState(pr.state) === "OPEN") {
    try {
      await adapter.closePr(plan, pr);
      actions.push({ action: "close_pr", number: pr.number });
    } catch (error) {
      failures.push(failure("close_pr", error));
    }
  }

  if (issue && normalizeState(issue.state) === "OPEN") {
    try {
      await adapter.closeIssue(plan, issue);
      actions.push({ action: "close_issue", number: issue.number });
    } catch (error) {
      failures.push(failure("close_issue", error));
    }
  }

  if (branchExists) {
    try {
      await adapter.deleteBranch(plan);
      actions.push({ action: "delete_branch", branch: plan.branch });
    } catch (error) {
      failures.push(failure("delete_branch", error));
    }
  }

  return {
    schemaVersion: 1,
    kind: "github-delivery/live-fixture-cleanup-report",
    repo: plan.repo,
    runId: plan.runId,
    marker: plan.marker,
    branch: plan.branch,
    complete: failures.length === 0,
    actions,
    failures,
    resources: {
      pr: pr ? { number: pr.number, state: pr.state || null } : null,
      issue: issue ? { number: issue.number, state: issue.state || null } : null,
      branchExisted: Boolean(branchExists),
    },
  };
}
