import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveWorkItemMilestone,
  normalizeWorkItemKey,
  planTrackerReconciliation,
  planWorkItemDelivery,
  selectTrackerStatus,
} from "../../scripts/lib/work-item-delivery.mjs";

const statuses = [
  { id: "backlog", name: "Backlog", type: "backlog" },
  { id: "todo", name: "Todo", type: "unstarted" },
  { id: "progress", name: "In Progress", type: "started" },
  { id: "review", name: "In Review", type: "started" },
  { id: "done", name: "Done", type: "completed" },
];

test("normalizes external work-item keys without accepting arbitrary text", () => {
  assert.equal(normalizeWorkItemKey("eng-123"), "ENG-123");
  assert.throws(() => normalizeWorkItemKey("issue #123"), /work_item_key_invalid/);
});

test("review mapping requires an explicit started review-like status instead of guessing any started status", () => {
  const result = selectTrackerStatus(statuses, "review");
  assert.equal(result.state, "resolved");
  assert.equal(result.status.id, "review");

  const withoutReview = statuses.filter((status) => status.id !== "review");
  assert.equal(selectTrackerStatus(withoutReview, "review").state, "unknown");
});

test("completed statuses with review-like names are not valid review targets", () => {
  const result = selectTrackerStatus([
    ...statuses.filter((status) => status.id !== "review"),
    { id: "review-complete", name: "Review Complete", type: "completed" },
  ], "review");
  assert.equal(result.state, "unknown");
  assert.deepEqual(result.candidates, []);
});

test("ambiguous tracker status configuration fails closed", () => {
  const result = selectTrackerStatus([
    ...statuses,
    { id: "peer-review", name: "Peer Review", type: "started" },
  ], "review");
  assert.equal(result.state, "ambiguous");
  assert.equal(result.candidates.length, 2);
});

test("GitHub evidence determines the lifecycle milestone", () => {
  assert.equal(deriveWorkItemMilestone({ merged: true }).milestone, "done");
  assert.equal(deriveWorkItemMilestone({ openPullRequest: true }).milestone, "review");
  assert.equal(deriveWorkItemMilestone({ publishedBranch: true }).milestone, "active");
  assert.equal(deriveWorkItemMilestone({ known: true }).milestone, "backlog");
  assert.equal(deriveWorkItemMilestone({}).state, "unknown");
});

test("tracker reconciliation binds expected and target status IDs", () => {
  const result = planTrackerReconciliation({
    workItem: { key: "ENG-42", statusId: "progress" },
    statuses,
    evidence: { openPullRequest: true },
  });
  assert.equal(result.state, "transition");
  assert.deepEqual(result.mutation, {
    kind: "tracker-status-transition",
    workItemKey: "ENG-42",
    expectedStatusId: "progress",
    targetStatusId: "review",
  });
});

test("tracker reconciliation is a no-op when current status is already correct", () => {
  const result = planTrackerReconciliation({
    workItem: { key: "ENG-42", statusId: "done" },
    statuses,
    evidence: { merged: true },
  });
  assert.equal(result.state, "noop");
  assert.equal(result.mutation, null);
});

test("work-item delivery reuses a covering PR before starting new work", () => {
  const coveringPullRequest = { number: 91, state: "open" };
  assert.deepEqual(
    planWorkItemDelivery({ workItem: { key: "ENG-42" }, coveringPullRequest }),
    { key: "ENG-42", phase: "resume_pr", coveringPullRequest, reason: "covering_pr" },
  );
});

test("merged work proceeds to reconciliation instead of publication", () => {
  const result = planWorkItemDelivery({ workItem: { key: "ENG-42" }, evidence: { merged: true } });
  assert.equal(result.phase, "reconcile");
});
