import assert from "node:assert/strict";
import test from "node:test";

import { planNativeReviewSidecar } from "../../scripts/lib/native-review-sidecar.mjs";

const HEAD = "abcdef1234567890abcdef1234567890abcdef12";

function context(overrides = {}) {
  return {
    label: "changes-requested",
    viewerLogin: "reviewer",
    authorLogin: "author",
    canRequestChanges: true,
    reviews: [],
    repo: "acme/widgets",
    pr: 32,
    expectedHead: HEAD,
    mutationMode: "review",
    ...overrides,
  };
}

function ownedReview(overrides = {}) {
  return {
    id: 77,
    node_id: "PRR_owned",
    state: "CHANGES_REQUESTED",
    user: { login: "reviewer" },
    ...overrides,
  };
}

test("request-changes on a foreign PR with write permission submits native Request changes", () => {
  const plan = planNativeReviewSidecar(context());
  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].action, "post_review");
  assert.equal(plan.operations[0].event, "request-changes");
  assert.equal(plan.skippedRequestChanges, false);
  assert.match(plan.operations[0].body, /\[GD\] Verdict/);
  assert.doesNotMatch(plan.operations[0].body, /## \[GD\] Verdict:/);
  assert.equal(plan.operations.some((operation) => operation.event === "approve"), false);
});

test("own pull request skips native Request changes", () => {
  const plan = planNativeReviewSidecar(
    context({ viewerLogin: "author", authorLogin: "Author" }),
  );
  assert.deepEqual(plan.operations, []);
  assert.equal(plan.skippedRequestChanges, true);
  assert.ok(plan.skipReasons.includes("own_pull_request"));
});

test("missing write permission skips native Request changes", () => {
  const plan = planNativeReviewSidecar(context({ canRequestChanges: false }));
  assert.deepEqual(plan.operations, []);
  assert.equal(plan.skippedRequestChanges, true);
  assert.ok(plan.skipReasons.includes("permission_missing"));
});

test("later changes-requested pass dismisses our pending review then requests changes again", () => {
  const plan = planNativeReviewSidecar(
    context({
      reviews: [
        ownedReview(),
        {
          node_id: "PRR_other",
          state: "CHANGES_REQUESTED",
          user: { login: "someone-else" },
        },
        {
          node_id: "PRR_dismissed",
          state: "DISMISSED",
          user: { login: "reviewer" },
        },
      ],
    }),
  );
  assert.equal(plan.operations[0].action, "dismiss_review");
  assert.equal(plan.operations[0].reviewId, "PRR_owned");
  assert.equal(plan.operations[0].actorLogin, "reviewer");
  assert.equal(plan.operations[1].action, "post_review");
  assert.equal(plan.operations[1].event, "request-changes");
  assert.equal(plan.operations.length, 2);
});

test("approve-comment dismisses our pending Request changes and never approves", () => {
  const plan = planNativeReviewSidecar(
    context({
      label: "approve-comment",
      reviews: [ownedReview({ node_id: "PRR_pending" })],
    }),
  );
  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].action, "dismiss_review");
  assert.equal(plan.operations[0].reviewId, "PRR_pending");
  assert.equal(
    plan.operations.some((operation) => operation.action === "post_review"),
    false,
  );
  assert.equal(
    plan.operations.some((operation) => operation.event === "approve"),
    false,
  );
});

test("not-useful leaves pending Request changes in place", () => {
  const plan = planNativeReviewSidecar(
    context({
      label: "not-useful",
      reviews: [ownedReview()],
    }),
  );
  assert.deepEqual(plan.operations, []);
});
