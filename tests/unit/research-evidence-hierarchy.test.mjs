import assert from "node:assert/strict";
import test from "node:test";

import { rankResearchEvidence } from "../../scripts/lib/research-evidence-hierarchy.mjs";

test("runtime behavior prefers exact runtime evidence over prose sources", () => {
  const result = rankResearchEvidence({
    claimType: "runtime-behavior",
    evidence: [
      { id: "blog", kind: "blog", conclusion: "broken" },
      { id: "runtime", kind: "runtime-reproduction", conclusion: "fixed", headSha: "a".repeat(40) },
      { id: "docs", kind: "official-docs", conclusion: "broken" },
    ],
  });

  assert.equal(result.ranked[0].id, "runtime");
  assert.equal(result.preferredConclusion, "fixed");
});

test("contract claims prefer repository/spec authority over observed accidental behavior", () => {
  const result = rankResearchEvidence({
    claimType: "contract",
    evidence: [
      { id: "runtime", kind: "runtime-reproduction", conclusion: "accepts-http" },
      { id: "spec", kind: "repository-spec", conclusion: "https-only" },
      { id: "source", kind: "shipping-source", conclusion: "accepts-http" },
    ],
  });

  assert.equal(result.ranked[0].id, "spec");
  assert.equal(result.preferredConclusion, "https-only");
});

test("history claims prefer commits and PR timeline evidence", () => {
  const result = rankResearchEvidence({
    claimType: "history",
    evidence: [
      { id: "maintainer", kind: "maintainer-statement", conclusion: "landed-last-week" },
      { id: "commit", kind: "commit", conclusion: "landed-2026-08-04" },
      { id: "blog", kind: "blog", conclusion: "landed-last-month" },
    ],
  });

  assert.equal(result.ranked[0].id, "commit");
});

test("external prior art prefers official/primary sources over blogs and model memory", () => {
  const result = rankResearchEvidence({
    claimType: "external-prior-art",
    evidence: [
      { id: "memory", kind: "model-memory", conclusion: "method-a" },
      { id: "blog", kind: "blog", conclusion: "method-b" },
      { id: "primary", kind: "primary-repository", conclusion: "method-c" },
      { id: "paper", kind: "primary-research", conclusion: "method-d" },
    ],
  });

  assert.deepEqual(result.ranked.slice(0, 2).map((item) => item.id), ["primary", "paper"]);
  assert.equal(result.ranked.at(-1).id, "memory");
});

test("same-tier contradictory evidence stays visible instead of being averaged away", () => {
  const result = rankResearchEvidence({
    claimType: "runtime-behavior",
    evidence: [
      { id: "run-a", kind: "runtime-reproduction", conclusion: "reproduced", headSha: "a".repeat(40) },
      { id: "run-b", kind: "runtime-reproduction", conclusion: "not-reproduced", headSha: "a".repeat(40) },
    ],
  });

  assert.equal(result.conflicted, true);
  assert.deepEqual(new Set(result.topConclusions), new Set(["reproduced", "not-reproduced"]));
  assert.equal(result.preferredConclusion, null);
});

test("stale or unbound runtime evidence is downgraded for current-head claims", () => {
  const head = "b".repeat(40);
  const result = rankResearchEvidence({
    claimType: "runtime-behavior",
    currentHeadSha: head,
    evidence: [
      { id: "stale-run", kind: "runtime-reproduction", conclusion: "reproduced", headSha: "a".repeat(40) },
      { id: "current-source", kind: "shipping-source", conclusion: "fixed", headSha: head },
    ],
  });

  assert.equal(result.ranked[0].id, "current-source");
  assert.ok(result.ranked.find((item) => item.id === "stale-run").penalties.includes("stale-head"));
});

test("unsupported claim types fail closed", () => {
  assert.throws(() => rankResearchEvidence({ claimType: "vibes", evidence: [] }), /unknown research claim type/);
});
