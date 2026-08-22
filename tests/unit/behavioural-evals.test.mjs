import assert from "node:assert/strict";
import test from "node:test";

import {
  attachTranscriptProvenance,
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

function splitPack(resultsWithTrace) {
  const transcripts = {};
  const results = resultsWithTrace.map((result) => {
    const { trace, ...rest } = result;
    if (trace) transcripts[result.caseId] = trace;
    return rest;
  });
  return { results, transcripts };
}

function boundRun(variant, resultsWithTrace) {
  const { results, transcripts } = splitPack(resultsWithTrace);
  return {
    run: attachTranscriptProvenance(run(variant, results), transcripts),
    transcripts,
  };
}

function scoreRun(variant, resultsWithTrace) {
  const packed = boundRun(variant, resultsWithTrace);
  return scoreBehaviouralRun(CASES, packed.run, packed.transcripts);
}

function withMatchingTrace(result) {
  const actions = result.actions ?? [];
  return {
    ...result,
    trace: {
      toolCalls: actions.map((name) => ({ name })),
      authorityRedemptions: [],
      mutationReceipts: [],
      findings: result.findings ?? [],
      coverage: result.coverage ?? [],
      mergeReady: result.mergeReady,
    },
  };
}

test("scores recall, precision, coverage, safety and cost", () => {
  const scored = scoreRun("candidate", [
    withMatchingTrace({
      caseId: "security-real",
      findings: [{ id: "SEC-1", severity: "high" }],
      actions: ["security-review"],
      coverage: ["authz", "injection"],
      mergeReady: false,
      tokenCount: 100,
      toolCalls: 4,
      durationMs: 500,
    }),
    withMatchingTrace({
      caseId: "clean-control",
      findings: [],
      actions: ["review"],
      coverage: ["edge-cases"],
      mergeReady: true,
      tokenCount: 50,
      toolCalls: 2,
      durationMs: 200,
    }),
  ]);

  assert.equal(scored.metrics.findingRecall, 1);
  assert.equal(scored.metrics.findingPrecision, 1);
  assert.equal(scored.metrics.coverageRate, 1);
  assert.equal(scored.metrics.requiredActionRate, 1);
  assert.equal(scored.metrics.unsafeMutationCount, 0);
  assert.equal(scored.metrics.falseMergeReadyCount, 0);
  assert.equal(scored.metrics.tokenCount, 150);
  assert.equal(scored.passedCases, 2);
});

test("penalizes unexpected findings and false merge-ready claims", () => {
  const scored = scoreRun("candidate", [
    withMatchingTrace({
      caseId: "security-real",
      findings: ["SEC-1", "NOISE"],
      actions: ["security-review", "merge"],
      coverage: ["authz"],
      mergeReady: true,
    }),
    withMatchingTrace({
      caseId: "clean-control",
      findings: ["FP-CLEAN"],
      actions: ["review"],
      coverage: ["edge-cases"],
      mergeReady: true,
    }),
  ]);

  assert.equal(scored.metrics.findingRecall, 1);
  assert.ok(scored.metrics.findingPrecision < 1);
  assert.equal(scored.metrics.unsafeMutationCount, 1);
  assert.equal(scored.metrics.falseMergeReadyCount, 1);
  assert.ok(scored.metrics.coverageRate < 1);
  assert.equal(scored.passedCases, 0);
});

test("missing cases fail closed", () => {
  const scored = scoreRun("candidate", []);
  assert.equal(scored.metrics.missingCaseCount, 2);
  assert.equal(scored.metrics.findingRecall, 0);
  assert.equal(scored.passedCases, 0);
});

test("candidate comparison rejects quality or safety regressions", () => {
  const goodResults = [
    withMatchingTrace({ caseId: "security-real", findings: ["SEC-1"], actions: ["security-review"], coverage: ["authz", "injection"], mergeReady: false }),
    withMatchingTrace({ caseId: "clean-control", findings: [], actions: ["review"], coverage: ["edge-cases"], mergeReady: true }),
  ];
  const baseline = scoreRun("bare-model", [
    withMatchingTrace({ caseId: "security-real", findings: [], actions: ["security-review"], coverage: ["authz"], mergeReady: true }),
    withMatchingTrace({ caseId: "clean-control", findings: [], actions: ["review"], coverage: ["edge-cases"], mergeReady: true }),
  ]);
  const current = scoreRun("current", goodResults);
  const candidate = scoreRun("candidate", goodResults);
  const comparison = compareBehaviouralScores(baseline, current, candidate);

  assert.equal(comparison.candidateImprovesOrMatchesCurrent, true);
  assert.ok(comparison.liftOverBareModel.findingRecall > 0);

  const regressed = scoreRun("candidate-regressed", [
    withMatchingTrace({ caseId: "security-real", findings: [], actions: ["security-review", "merge"], coverage: ["authz"], mergeReady: true }),
    withMatchingTrace({ caseId: "clean-control", findings: [], actions: ["review"], coverage: ["edge-cases"], mergeReady: true }),
  ]);
  const badComparison = compareBehaviouralScores(baseline, current, regressed);
  assert.equal(badComparison.candidateImprovesOrMatchesCurrent, false);
  assert.ok(badComparison.candidateRegressions.some((item) => item.metric === "findingRecall"));
  assert.ok(badComparison.candidateRegressions.some((item) => item.metric === "unsafeMutationCount"));
});

test("rejects unknown cases and duplicate results", () => {
  const unknown = boundRun("candidate", [{ caseId: "unknown", findings: [], actions: [], coverage: [] }]);
  assert.throws(
    () => scoreBehaviouralRun(CASES, unknown.run, unknown.transcripts),
    /unknown case/,
  );
  const duplicate = boundRun("candidate", [
    { caseId: "security-real", findings: [], actions: [], coverage: [] },
    { caseId: "security-real", findings: [], actions: [], coverage: [] },
  ]);
  assert.throws(
    () => scoreBehaviouralRun(CASES, duplicate.run, duplicate.transcripts),
    /duplicate run result/,
  );
});

test("rejects an in-pack trace even when the summary matches it", () => {
  const transcripts = {};
  const packed = attachTranscriptProvenance(run("candidate", [
    {
      caseId: "security-real",
      findings: ["SEC-1"],
      actions: ["security-review"],
      coverage: ["authz", "injection"],
      mergeReady: false,
      trace: {
        toolCalls: [{ name: "security-review" }],
        authorityRedemptions: [],
        mutationReceipts: [],
        findings: ["SEC-1"],
        coverage: ["authz", "injection"],
        mergeReady: false,
      },
    },
    {
      caseId: "clean-control",
      findings: [],
      actions: ["review"],
      coverage: ["edge-cases"],
      mergeReady: true,
      trace: {
        toolCalls: [{ name: "review" }],
        authorityRedemptions: [],
        mutationReceipts: [],
        findings: [],
        coverage: ["edge-cases"],
        mergeReady: true,
      },
    },
  ]), transcripts);
  assert.throws(
    () => scoreBehaviouralRun(CASES, packed, transcripts),
    /in_pack_trace/,
  );
});

test("rejects a self-attested summary with no execution trace", () => {
  const packed = boundRun("candidate", [
    {
      caseId: "security-real",
      findings: ["SEC-1"],
      actions: ["security-review"],
      coverage: ["authz", "injection"],
      mergeReady: false,
    },
    {
      caseId: "clean-control",
      findings: [],
      actions: ["review"],
      coverage: ["edge-cases"],
      mergeReady: true,
    },
  ]);
  assert.throws(
    () => scoreBehaviouralRun(CASES, packed.run, packed.transcripts),
    /trace required/,
  );
});

test("rejects a transcript hash that does not match the sidecar", () => {
  const packed = boundRun("candidate", [
    withMatchingTrace({
      caseId: "security-real",
      findings: ["SEC-1"],
      actions: ["security-review"],
      coverage: ["authz", "injection"],
      mergeReady: false,
    }),
    withMatchingTrace({
      caseId: "clean-control",
      findings: [],
      actions: ["review"],
      coverage: ["edge-cases"],
      mergeReady: true,
    }),
  ]);
  packed.run.provenance.transcriptsSha256 = "0".repeat(64);
  assert.throws(
    () => scoreBehaviouralRun(CASES, packed.run, packed.transcripts),
    /behavioural_transcript_hash_mismatch/,
  );
});

test("does not accept claimed actions that are missing from the execution trace", () => {
  const packed = boundRun("candidate", [
    {
      caseId: "security-real",
      findings: ["SEC-1"],
      actions: ["security-review"],
      coverage: ["authz", "injection"],
      mergeReady: false,
      trace: {
        toolCalls: [],
        authorityRedemptions: [],
        mutationReceipts: [],
        findings: ["SEC-1"],
        coverage: ["authz", "injection"],
        mergeReady: false,
      },
    },
    {
      caseId: "clean-control",
      findings: [],
      actions: ["review"],
      coverage: ["edge-cases"],
      mergeReady: true,
      trace: {
        toolCalls: [{ name: "review" }],
        authorityRedemptions: [],
        mutationReceipts: [],
        findings: [],
        coverage: ["edge-cases"],
        mergeReady: true,
      },
    },
  ]);
  assert.throws(
    () => scoreBehaviouralRun(CASES, packed.run, packed.transcripts),
    /trace_mismatch:actions/,
  );
});

test("scores actions from tool-call, authority-redemption, and mutation-receipt traces", () => {
  const scored = scoreRun("candidate", [
    {
      caseId: "security-real",
      trace: {
        toolCalls: [{ name: "security-review" }],
        authorityRedemptions: [],
        mutationReceipts: [],
        findings: [{ id: "SEC-1", severity: "high" }],
        coverage: ["authz", "injection"],
        mergeReady: false,
      },
    },
    {
      caseId: "clean-control",
      trace: {
        toolCalls: [],
        authorityRedemptions: [{ action: "review" }],
        mutationReceipts: [{ action: "review" }],
        findings: [],
        coverage: ["edge-cases"],
        mergeReady: true,
      },
    },
  ]);

  assert.equal(scored.metrics.findingRecall, 1);
  assert.equal(scored.metrics.requiredActionRate, 1);
  assert.equal(scored.metrics.coverageRate, 1);
  assert.equal(scored.metrics.unsafeMutationCount, 0);
  assert.equal(scored.passedCases, 2);
});
