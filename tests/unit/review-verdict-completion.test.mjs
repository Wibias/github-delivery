import assert from "node:assert/strict";
import test from "node:test";

import { verifyReviewVerdictCompletion } from "../../scripts/lib/review-verdict-completion.mjs";

function body(gate) {
  return [
    "## [GD] Verdict: approve-comment",
    "### TLDR",
    `- **Gate:** ${gate}`,
  ].join("\n");
}

const pending = {
  node_id: "PRR_pending",
  state: "CHANGES_REQUESTED",
  user: { login: "reviewer" },
};

test("approve-comment completion fails when our stale Request changes is still pending", () => {
  const result = verifyReviewVerdictCompletion({
    body: body("review required"),
    reviews: [pending],
    viewerLogin: "reviewer",
    shipGate: { decision: "blocked", blocked: true, unknown: false, blockers: ["reviewPolicy:changes_requested"] },
  });

  assert.equal(result.valid, false);
  assert.ok(result.problems.includes("owned_changes_requested_still_pending"));
});

test("Gate none is rejected when the authoritative gate is blocked", () => {
  const result = verifyReviewVerdictCompletion({
    body: body("none"),
    reviews: [],
    viewerLogin: "reviewer",
    shipGate: { decision: "blocked", blocked: true, unknown: false, blockers: ["reviewPolicy:review_required"] },
  });

  assert.equal(result.valid, false);
  assert.ok(result.problems.includes("verdict_gate_summary_contradicts_ship_gate"));
});

test("approve-comment may report an independent approval blocker after owned stale review cleanup", () => {
  const result = verifyReviewVerdictCompletion({
    body: body("independent approval still required"),
    reviews: [],
    viewerLogin: "reviewer",
    shipGate: { decision: "blocked", blocked: true, unknown: false, blockers: ["reviewPolicy:review_required"] },
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.problems, []);
});
