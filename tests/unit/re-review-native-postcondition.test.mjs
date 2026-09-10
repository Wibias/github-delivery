import assert from "node:assert/strict";
import test from "node:test";

import { verifyNativeReviewSidecarPostcondition } from "../../scripts/lib/native-review-sidecar.mjs";

const ownedPending = {
  node_id: "PRR_pending",
  state: "CHANGES_REQUESTED",
  user: { login: "reviewer" },
};

const ownedDismissed = {
  ...ownedPending,
  state: "DISMISSED",
};

test("approve-comment postcondition fails while our superseded Request changes remains pending", () => {
  const result = verifyNativeReviewSidecarPostcondition({
    label: "approve-comment",
    viewerLogin: "reviewer",
    reviews: [ownedPending],
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, "owned_changes_requested_still_pending");
  assert.deepEqual(result.pendingReviewIds, ["PRR_pending"]);
});

test("approve-comment postcondition passes after our Request changes is dismissed", () => {
  const result = verifyNativeReviewSidecarPostcondition({
    label: "approve-comment",
    viewerLogin: "reviewer",
    reviews: [ownedDismissed],
  });

  assert.equal(result.valid, true);
  assert.equal(result.reason, null);
  assert.deepEqual(result.pendingReviewIds, []);
});

test("non-approval verdicts do not require stale-review cleanup", () => {
  const result = verifyNativeReviewSidecarPostcondition({
    label: "gated",
    viewerLogin: "reviewer",
    reviews: [ownedPending],
  });

  assert.equal(result.valid, true);
});
