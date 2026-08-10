import assert from "node:assert/strict";
import test from "node:test";

import {
  assertContextHead,
  buildReviewContext,
  REVIEW_CONTEXT_PHASES,
} from "../../scripts/lib/review-context.mjs";

const INPUT = {
  repo: "owner/repo",
  pr: 42,
  baseSha: "base",
  headSha: "head",
  diff: "@@ -1 +1 @@",
  changedFiles: ["src/auth.mjs"],
  adjacentSource: { "src/auth.mjs": "export function auth() {}" },
  tests: ["tests/auth.test.mjs"],
  repositoryPolicies: ["SECURITY.md"],
  staticEvidence: [{ tool: "semgrep", result: "clean" }],
  scopePlan: { securityReviewDepth: "full" },
  requiredProbes: ["removed-controls"],
  prTitle: "Obviously safe refactor",
  prBody: "No security impact.",
  author: "trusted-maintainer",
  labels: ["safe"],
  issue: { title: "Refactor only" },
  spec: "No behavior change",
  commitMessages: ["safe cleanup"],
  reviewComments: ["LGTM"],
  reviewerVerdicts: ["approved"],
  botConclusions: ["no issues"],
  futureMetadata: "must not leak through an allowlist",
};

test("blind discovery exposes evidence but withholds framing metadata", () => {
  const record = buildReviewContext(INPUT);

  assert.equal(record.phase, REVIEW_CONTEXT_PHASES.BLIND_DISCOVERY);
  assert.equal(record.context.headSha, "head");
  assert.equal(record.context.diff, INPUT.diff);
  assert.deepEqual(record.context.requiredProbes, ["removed-controls"]);
  assert.equal(record.context.prTitle, undefined);
  assert.equal(record.context.issue, undefined);
  assert.equal(record.context.futureMetadata, undefined);
  assert.ok(record.withheldKeys.includes("prTitle"));
  assert.ok(record.withheldKeys.includes("futureMetadata"));
});

test("blind discovery does not mutate the caller context", () => {
  const before = structuredClone(INPUT);
  const record = buildReviewContext(INPUT);
  record.context.changedFiles.push("src/other.mjs");
  assert.deepEqual(INPUT, before);
});

test("context reconciliation exposes the complete context", () => {
  const record = buildReviewContext(INPUT, {
    phase: REVIEW_CONTEXT_PHASES.CONTEXT_RECONCILIATION,
  });

  assert.equal(record.context.prTitle, INPUT.prTitle);
  assert.deepEqual(record.context.reviewComments, INPUT.reviewComments);
  assert.deepEqual(record.withheldKeys, []);
});

test("review context is bound to the reviewed head", () => {
  const record = buildReviewContext(INPUT);
  assert.equal(assertContextHead(record, "head"), true);
  assert.throws(() => assertContextHead(record, "new-head"), /stale review context/);
});

test("review context fingerprints are deterministic and phase-sensitive", () => {
  const first = buildReviewContext(INPUT);
  const reordered = buildReviewContext(Object.fromEntries(Object.entries(INPUT).reverse()));
  const reconciled = buildReviewContext(INPUT, {
    phase: REVIEW_CONTEXT_PHASES.CONTEXT_RECONCILIATION,
  });

  assert.equal(first.fingerprint, reordered.fingerprint);
  assert.notEqual(first.fingerprint, reconciled.fingerprint);
});

test("review context rejects missing heads and unknown phases", () => {
  assert.throws(() => buildReviewContext({ diff: "x" }), /requires headSha/);
  assert.throws(() => buildReviewContext(INPUT, { phase: "something-else" }), /unknown review context phase/);
});
