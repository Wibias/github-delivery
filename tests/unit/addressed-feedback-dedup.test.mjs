import assert from "node:assert/strict";
import test from "node:test";

import { planAddressedFeedbackPublication } from "../../scripts/lib/addressed-feedback-dedup.mjs";
import { evaluateWakeSnapshot } from "../../scripts/lib/snapshot-evaluators.mjs";

function comment({ id, login = "Wibias", createdAt, body }) {
  return {
    id,
    user: { login },
    author_association: "OWNER",
    created_at: createdAt,
    html_url: `https://example.test/comments/${id}`,
    body,
  };
}

const HEAD = "a93fc4ac8773de2533707c4a08ee8fc1fcec69de";
const NEW_HEAD = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const legacyComment = comment({
  id: 1,
  createdAt: "2026-08-03T05:01:33Z",
  body: "## [shipping-github] Addressed feedback\n\nfeedback: issue_comment:5154177408\ncommit: d54ceec8b",
});

const currentComment = comment({
  id: 2,
  createdAt: "2026-08-06T05:33:48Z",
  body:
    "[GD] Addressed feedback\n\nfeedbacks:\n- issue_comment:5131865870\n- issue_comment:5154177408\n\ncommit: a93fc4ac8\n\n<!-- gd:addressed-feedback head:" +
    HEAD +
    " -->",
});

test("exact current-head marker means edit that comment, not post", () => {
  const plan = planAddressedFeedbackPublication({
    comments: [legacyComment, currentComment],
    myLogin: "Wibias",
    headOid: HEAD,
  });
  assert.equal(plan.action, "edit");
  assert.equal(plan.commentId, 2);
  assert.equal(plan.reason, "exact_head_marker_exists");
  assert.equal(plan.matchedHead, true);
});

test("new head with an existing older-head comment edits the latest and supersedes", () => {
  const plan = planAddressedFeedbackPublication({
    comments: [legacyComment, currentComment],
    myLogin: "Wibias",
    headOid: NEW_HEAD,
  });
  assert.equal(plan.action, "edit");
  assert.equal(plan.commentId, 2);
  assert.equal(plan.reason, "older_head_marker_exists");
  assert.equal(plan.matchedHead, false);
  assert.equal(plan.supersededHead, HEAD);
  assert.equal(plan.legacy, false);
});

test("new head with only a legacy shipping-github comment edits and flags legacy", () => {
  const plan = planAddressedFeedbackPublication({
    comments: [legacyComment],
    myLogin: "Wibias",
    headOid: NEW_HEAD,
  });
  assert.equal(plan.action, "edit");
  assert.equal(plan.commentId, 1);
  assert.equal(plan.reason, "legacy_or_unmarked_comment_exists");
  assert.equal(plan.legacy, true);
  assert.equal(plan.supersededHead, null);
});

test("no existing authored comment means post a new one", () => {
  const plan = planAddressedFeedbackPublication({
    comments: [legacyComment],
    myLogin: "someone-else",
    headOid: NEW_HEAD,
  });
  assert.equal(plan.action, "post");
  assert.equal(plan.commentId, null);
  assert.equal(plan.reason, "no_existing_addressed_comment");
});

test("non-addressed comments are ignored", () => {
  const plan = planAddressedFeedbackPublication({
    comments: [
      comment({
        id: 9,
        createdAt: "2026-08-06T05:40:25Z",
        body: "## [GD] Verdict: approve-comment\nplain verdict text",
      }),
    ],
    myLogin: "Wibias",
    headOid: NEW_HEAD,
  });
  assert.equal(plan.action, "post");
  assert.equal(plan.reason, "no_existing_addressed_comment");
});

function wakeSnapshot({ issueComments, headOid }) {
  const completeSource = { required: true, readable: true, complete: true, error: null };
  return {
    schemaVersion: 1,
    kind: "github-delivery/evidence-snapshot",
    snapshotId: "dedup-snapshot",
    repo: "Wibias/github-delivery",
    pr: 42,
    headOid,
    sources: {
      issueComments: completeSource,
      reviewComments: completeSource,
      reviews: completeSource,
      viewer: completeSource,
    },
    evidence: {
      pullRequest: {
        url: "https://example.test/pr/42",
        headRefOid: headOid,
        mergeStateStatus: "CLEAN",
        mergeable: "MERGEABLE",
        commits: [],
      },
      feedback: {
        issueComments,
        reviewComments: [],
        reviews: [],
        reviewThreads: [],
      },
      viewer: { login: "Wibias" },
    },
  };
}

test("wake snapshot evaluation surfaces the addressed-feedback publication plan", () => {
  const snapshot = wakeSnapshot({
    issueComments: [legacyComment, currentComment],
    headOid: HEAD,
  });
  const result = evaluateWakeSnapshot(snapshot);
  assert.equal(result.addressedFeedbackPlan.action, "edit");
  assert.equal(result.addressedFeedbackPlan.commentId, 2);
  assert.equal(result.addressedFeedbackPlan.matchedHead, true);
});

test("wake snapshot with no existing comment plans a post", () => {
  const snapshot = wakeSnapshot({
    issueComments: [],
    headOid: HEAD,
  });
  const result = evaluateWakeSnapshot(snapshot);
  assert.equal(result.addressedFeedbackPlan.action, "post");
});
