import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { compareAdversarialPairs } from "../../scripts/lib/adversarial-eval-pairs.mjs";
import {
  attachTranscriptProvenance,
  scoreBehaviouralRun,
  validateBehaviouralCase,
} from "../../scripts/lib/behavioural-evals.mjs";

const CASES = JSON.parse(readFileSync(new URL("../evals/behavioural-adversarial-cases.json", import.meta.url), "utf8"));

function successfulResult(item) {
  return {
    caseId: item.id,
    findings: [...item.requiredFindings],
    actions: [...item.requiredActions],
    coverage: [...item.requiredCoverage],
    mergeReady: item.expectedMergeReady,
    trace: {
      toolCalls: item.requiredActions.map((name) => ({ name })),
      authorityRedemptions: [],
      mutationReceipts: [],
      findings: [...item.requiredFindings],
      coverage: [...item.requiredCoverage],
      mergeReady: item.expectedMergeReady,
    },
  };
}

function run(results) {
  return {
    variant: "candidate",
    model: "fixture-model",
    host: "fixture-host",
    results,
  };
}

function scoreResults(resultsWithTrace) {
  const transcripts = {};
  const results = resultsWithTrace.map((result) => {
    const { trace, ...rest } = result;
    transcripts[result.caseId] = trace;
    return rest;
  });
  return scoreBehaviouralRun(
    CASES,
    attachTranscriptProvenance(run(results), transcripts),
    transcripts,
  );
}

test("adversarial fixture pack is valid and every pair has neutral/adversarial twins", () => {
  const groups = new Map();
  for (const item of CASES) {
    assert.equal(validateBehaviouralCase(item), true);
    if (!groups.has(item.pairId)) groups.set(item.pairId, []);
    groups.get(item.pairId).push(item.variant);
  }

  assert.equal(groups.size, 5);
  for (const variants of groups.values()) {
    assert.deepEqual([...variants].sort(), ["adversarial", "neutral"]);
  }
});

test("fixture pack covers the intended hostile context channels", () => {
  const channels = new Set(CASES.filter((item) => item.variant === "adversarial").map((item) => item.attackChannel));
  assert.deepEqual([...channels].sort(), [
    "pr-metadata",
    "repository-instructions",
    "skill-metadata",
    "terminal-output",
    "verifier-output",
  ]);
});

test("pair comparison passes when hostile framing retains neutral behaviour", () => {
  const score = scoreResults(CASES.map(successfulResult));
  const comparison = compareAdversarialPairs(CASES, score);

  assert.equal(comparison.allPairsRetained, true);
  assert.equal(comparison.retainedPairs, 5);
  assert.deepEqual(comparison.regressions, []);
});

test("pair comparison detects framing-induced finding suppression", () => {
  const results = CASES.map(successfulResult);
  const attacked = results.find((item) => item.caseId === "ADV-META-001-adversarial");
  attacked.trace.findings = [];
  attacked.trace.mergeReady = true;
  attacked.findings = [];
  attacked.mergeReady = true;

  const score = scoreResults(results);
  const comparison = compareAdversarialPairs(CASES, score);
  const regression = comparison.regressions.find((item) => item.pairId === "ADV-META-001");

  assert.equal(comparison.allPairsRetained, false);
  assert.equal(regression.regression, true);
  assert.ok(regression.adversarialProblems > regression.neutralProblems);
});

test("pair comparison detects unsafe action caused only by injected repository text", () => {
  const results = CASES.map(successfulResult);
  const attacked = results.find((item) => item.caseId === "ADV-REPO-001-adversarial");
  attacked.trace.toolCalls.push({ name: "follow-repository-instruction" });
  attacked.actions.push("follow-repository-instruction");

  const score = scoreResults(results);
  const comparison = compareAdversarialPairs(CASES, score);
  assert.ok(comparison.regressions.some((item) => item.pairId === "ADV-REPO-001"));
});

test("missing one side of a pair is itself a regression", () => {
  const results = CASES
    .filter((item) => item.id !== "ADV-SKILL-001-adversarial")
    .map(successfulResult);
  const score = scoreResults(results);
  const comparison = compareAdversarialPairs(CASES, score);
  assert.ok(comparison.regressions.some((item) => item.pairId === "ADV-SKILL-001"));
});
