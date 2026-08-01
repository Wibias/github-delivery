import { createHash } from "node:crypto";

const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export const REQUIRED_EVENTS = Object.freeze([
  "issue_created",
  "branch_created",
  "draft_pr_created",
  "draft_gate_observed",
  "ready_transitioned",
  "checks_observed",
  "snapshot_captured",
  "head_changed",
  "stale_head_rejected",
  "final_gate_observed",
  "pr_disposed",
  "issue_closed",
  "branch_deleted",
]);

function safeSegment(value) {
  return String(value).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function buildFixturePlan({ repo, runId, baseBranch = "main", disposition = "close", prefix = "shipping-github-fixture" } = {}) {
  if (!REPO_RE.test(repo || "")) throw new Error("repo must be OWNER/REPO");
  if (!RUN_ID_RE.test(runId || "")) throw new Error("runId must be 3-64 safe characters");
  if (!/^[A-Za-z0-9._/-]+$/.test(baseBranch || "")) throw new Error("unsafe baseBranch");
  if (!new Set(["close", "merge"]).has(disposition)) throw new Error("disposition must be close or merge");
  const token = safeSegment(runId);
  const marker = `[shipping-github-fixture:${token}]`;
  return Object.freeze({
    schemaVersion: 1,
    kind: "shipping-github/live-fixture-plan",
    repo,
    runId: token,
    baseBranch,
    disposition,
    marker,
    branch: `${safeSegment(prefix)}/${token}`,
    fixturePath: `.shipping-github-fixtures/${token}.json`,
    issueTitle: `${marker} lifecycle issue`,
    prTitle: `${marker} lifecycle PR`,
    idempotencyKey: createHash("sha256").update(`${repo}\0${token}`).digest("hex"),
    requiredEvents: [...REQUIRED_EVENTS],
  });
}

export function assertSafeFixturePlan(plan) {
  const expected = buildFixturePlan(plan);
  if (expected.branch !== plan.branch || expected.marker !== plan.marker) throw new Error("fixture plan derived fields do not match inputs");
  if (!plan.branch.startsWith("shipping-github-fixture/")) throw new Error("refusing to mutate a non-fixture branch");
  return expected;
}

export function evaluateFixtureReceipt(plan, events) {
  assertSafeFixturePlan(plan);
  if (!Array.isArray(events)) throw new Error("events must be an array");
  const names = events.map((event) => event?.name).filter(Boolean);
  const missing = plan.requiredEvents.filter((name) => !names.includes(name));
  const duplicateNames = [...new Set(names.filter((name, i) => names.indexOf(name) !== i))];
  const stale = events.find((event) => event?.name === "stale_head_rejected");
  const draft = events.find((event) => event?.name === "draft_gate_observed");
  const checksEvent = events.find((event) => event?.name === "checks_observed");
  const checks = checksEvent?.checks || null;
  const finalGate = events.find((event) => event?.name === "final_gate_observed");
  const problems = [];
  if (missing.length) problems.push(`missing events: ${missing.join(", ")}`);
  if (duplicateNames.length) problems.push(`duplicate events: ${duplicateNames.join(", ")}`);
  if (stale && stale.outcome !== "rejected") problems.push("stale head mutation was not rejected");
  if (draft && draft.decision === "ready") problems.push("draft PR was incorrectly ready");
  if (!checks || checks.conclusion !== "success" || !Number.isInteger(checks.count) || checks.count < 1 || !Array.isArray(checks.checks) || checks.checks.length !== checks.count) {
    problems.push("checks evidence is missing, incomplete, or unsuccessful");
  }
  if (finalGate && !new Set(["ready", "blocked", "unknown"]).has(finalGate.decision)) problems.push("final gate decision is invalid");
  return {
    schemaVersion: 1,
    kind: "shipping-github/live-fixture-receipt",
    repo: plan.repo,
    runId: plan.runId,
    disposition: plan.disposition,
    passed: problems.length === 0,
    problems,
    eventCount: events.length,
    checks,
    events,
  };
}

function attachFailureReceipt(error, plan, events) {
  const failure = error instanceof Error ? error : new Error(String(error));
  const code = String(failure.code || "fixture_lifecycle_failed");
  const receipt = evaluateFixtureReceipt(plan, events);
  receipt.failure = { code, message: failure.message };
  receipt.problems.unshift(`${code}: ${failure.message}`);
  receipt.passed = false;
  failure.fixtureReceipt = receipt;
  return failure;
}

export async function runFixtureScenario(adapter, options) {
  const plan = buildFixturePlan(options);
  const events = [];
  const record = (name, details = {}) => events.push({ name, at: new Date().toISOString(), ...details });
  let issue = null;
  let pr = null;
  try {
    issue = await adapter.createIssue(plan);
    record("issue_created", { issue: issue.number });
    await adapter.createBranch(plan);
    record("branch_created", { branch: plan.branch });
    pr = await adapter.createDraftPr(plan, issue);
    record("draft_pr_created", { pr: pr.number });
    const draftGate = await adapter.evaluateGate(plan, pr);
    record("draft_gate_observed", { decision: draftGate.decision });
    if (draftGate.decision === "ready") throw new Error("draft PR must not be ready");
    await adapter.markReady(plan, pr);
    record("ready_transitioned");
    const checks = await adapter.waitForChecks(plan, pr);
    record("checks_observed", { conclusion: checks.conclusion, count: checks.count, checks });
    const snapshot = await adapter.captureSnapshot(plan, pr);
    record("snapshot_captured", { head: snapshot.head });
    await adapter.changeHead(plan, pr, snapshot.head);
    record("head_changed");
    const stale = await adapter.attemptStaleHeadMutation(plan, pr, snapshot.head);
    record("stale_head_rejected", { outcome: stale.rejected ? "rejected" : "accepted" });
    if (!stale.rejected) throw new Error("stale expected-head mutation unexpectedly succeeded");
    const finalGate = await adapter.evaluateGate(plan, pr);
    record("final_gate_observed", { decision: finalGate.decision });
    if (plan.disposition === "merge") await adapter.mergePr(plan, pr);
    else await adapter.closePr(plan, pr);
    record("pr_disposed", { disposition: plan.disposition });
    await adapter.closeIssue(plan, issue);
    record("issue_closed");
    await adapter.deleteBranch(plan);
    record("branch_deleted");
  } catch (error) {
    const failure = attachFailureReceipt(error, plan, events);
    await adapter.bestEffortCleanup?.(plan, { issue, pr, events, error: failure });
    throw failure;
  }
  const receipt = evaluateFixtureReceipt(plan, events);
  if (!receipt.passed) throw new Error(receipt.problems.join("; "));
  return receipt;
}
