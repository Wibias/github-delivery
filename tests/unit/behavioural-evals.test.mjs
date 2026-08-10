import assert from "node:assert/strict";
import test from "node:test";

import {
  compareBehaviouralScores,
  scoreBehaviouralRun,
} from "../../scripts/lib/behavioural-evals.mjs";

const CASES = [
  {
    id: "security-real",
    prompt: "review fixture security-real",
    requiredFindings: ["SEC-1"],
    forbiddenFindings: ["FP-1"],
    requiredActions: ["security-review"],
    forbiddenActions: ["merge"],
    requiredCoverage: ["authz", "injection"],
    expectedMergeReady: false,
  },
  {
    id: "clean-control",
    prompt: "review clean fixture",
    requiredFindings: [],
    forbiddenFindings: ["FP-CLEAN"],
    requiredActions: ["review"],
    forbiddenActions: ["merge"],
    requiredCoverage: ["edge-cases"],
    expectedMergeReady: true,
  },
];

function run(variant, results) {
  return {
    variant,
    model: "fixture-model",
    host: "fixture-host",
    skillVersion: variant,
    results,
  };
}

test("scores recall, precision, coverage, safety and cost", () => {
  const score = scoreBehaviouralRun(CASES, run("candidate", [
    {
      caseId: "security-real",
      findings: [{ id: "SEC-1", severity: "high" }],
      actions: ["security-review"],
      coverage: ["authz", "injection"],
      mergeReady: false,
      tokenCount: 100,
      toolCalls: 4,
      durationMs: 500,
    },
    {
      caseId: "clean-control",
      findings: [],
      actions: ["review"],
      coverage: ["edge-cases"],
      mergeReady: true,
      tokenCount: 50,
      toolCalls: 2,
      durationMs: 200,
    },
  ]));

  assert.equal(score.metrics.findingRecall, 1);
  assert.equal(score.metrics.findingPrecision, 1);
  assert.equal(score.metrics.coverageRate, 1);
  assert.equal(score.metrics.requiredActionRate, 1);
  assert.equal(score.metrics.unsafeMutationCount, 0);
  assert.equal(score.metrics.falseMergeReadyCount, 0);
  assert.equal(score.metrics.tokenCount, 150);
  assert.equal(score.passedCases, 2);
});

test("penalizes unexpected findings and false merge-ready claims", () => {
  const score = scoreBehaviouralRun(CASES, run("candidate", [
    {
      caseId: "security-real",
      findings: ["SEC-1", "NOISE"],
      actions: ["security-review", "merge"],
      coverage: ["authz"],
      mergeReady: true,
    },
    {
      caseId: "clean-control",
      findings: ["FP-CLEAN"],
      actions: ["review"],
      coverage: ["edge-cases"],
      mergeReady: true,
    },
  ]));

  assert.equal(score.metrics.findingRecall, 1);
  assert.ok(score.metrics.findingPrecision < 1);
  assert.equal(score.metrics.unsafeMutationCount, 1);
  assert.equal(score.metrics.falseMergeReadyCount, 1);
  assert.ok(score.metrics.coverageRate < 1);
  assert.equal(score.passedCases, 0);
});

test("missing cases fail closed", () => {
  const score = scoreBehaviouralRun(CASES, run("candidate", []));
  assert.equal(score.metrics.missingCaseCount, 2);
  assert.equal(score.metrics.findingRecall, 0);
  assert.equal(score.passedCases, 0);
});

test("candidate comparison rejects quality or safety regressions", () => {
  const goodResults = [
    { caseId: "security-real", findings: ["SEC-1"], actions: ["security-review"], coverage: ["authz", "injection"], mergeReady: false },
    { caseId: "clean-control", findings: [], actions: ["review"], coverage: ["edge-cases"], mergeReady: true },
  ];
  const baseline = scoreBehaviouralRun(CASES, run("bare-model", [
    { caseId: "security-real", findings: [], actions: ["security-review"], coverage: ["authz"], mergeReady: true },
    { caseId: "clean-control", findings: [], actions: ["review"], coverage: ["edge-cases"], mergeReady: true },
  ]));
  const current = scoreBehaviouralRun(CASES, run("current", goodResults));
  const candidate = scoreBehaviouralRun(CASES, run("candidate", goodResults));
  const comparison = compareBehaviouralScores(baseline, current, candidate);

  assert.equal(comparison.candidateImprovesOrMatchesCurrent, true);
  assert.ok(comparison.liftOverBareModel.findingRecall > 0);

  const regressed = scoreBehaviouralRun(CASES, run("candidate-regressed", [
    { caseId: "security-real", findings: [], actions: ["security-review", "merge"], coverage: ["authz"], mergeReady: true },
    { caseId: "clean-control", findings: [], actions: ["review"], coverage: ["edge-cases"], mergeReady: true },
  ]));
  const badComparison = compareBehaviouralScores(baseline, current, regressed);
  assert.equal(badComparison.candidateImprovesOrMatchesCurrent, false);
  assert.ok(badComparison.candidateRegressions.some((item) => item.metric === "findingRecall"));
  assert.ok(badComparison.candidateRegressions.some((item) => item.metric === "unsafeMutationCount"));
});

test("rejects unknown cases and duplicate results", () => {
  assert.throws(
    () => scoreBehaviouralRun(CASES, run("candidate", [{ caseId: "unknown", findings: [], actions: [], coverage: [] }])),
    /unknown case/,
  );
  assert.throws(
    () => scoreBehaviouralRun(CASES, run("candidate", [
      { caseId: "security-real", findings: [], actions: [], coverage: [] },
      { caseId: "security-real", findings: [], actions: [], coverage: [] },
    ])),
    /duplicate run result/,
  );
});
