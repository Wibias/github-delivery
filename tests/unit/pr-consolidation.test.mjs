import assert from "node:assert/strict";
import test from "node:test";

import { analyzePrConsolidation, planPrConsolidation } from "../../scripts/lib/pr-consolidation.mjs";

function pr(number, overrides = {}) {
  return {
    number,
    repository: "acme/widgets",
    base: "main",
    headRepository: "acme/widgets",
    head: `feature/${number}`,
    title: `PR ${number}`,
    files: [`src/${number}.mjs`],
    ...overrides,
  };
}

test("same work-item identity creates a candidate cluster but not automatic supersede confidence", () => {
  const result = analyzePrConsolidation([
    pr(10, { workItemKey: "ENG-42" }),
    pr(11, { workItemKey: "eng-42" }),
  ]);
  assert.equal(result.state, "candidates");
  assert.deepEqual(result.clusters[0].members, [10, 11]);
  assert.equal(result.clusters[0].confidence, "medium");
  assert.equal(result.clusters[0].evidence[0].evidence.supersedeGrade, false);
  assert.equal(result.clusters[0].canonicalPr, null);
  assert.equal(result.clusters[0].selectionRequired, true);
});

test("same work item plus substantial implementation overlap is high-confidence evidence", () => {
  const result = analyzePrConsolidation([
    pr(10, { workItemKey: "ENG-42", files: ["src/a.mjs", "src/b.mjs"] }),
    pr(11, { workItemKey: "ENG-42", files: ["src/a.mjs", "src/b.mjs", "src/c.mjs"] }),
  ]);
  assert.equal(result.clusters[0].confidence, "high");
  assert.equal(result.clusters[0].evidence[0].evidence.supersedeGrade, true);
});

test("uses substantial non-noise file overlap only as medium-confidence evidence", () => {
  const result = analyzePrConsolidation([
    pr(10, { files: ["src/a.mjs", "src/b.mjs", "README.md"] }),
    pr(11, { files: ["src/a.mjs", "src/b.mjs", "src/c.mjs", "README.md"] }),
  ]);
  assert.equal(result.clusters[0].confidence, "medium");
  assert.equal(result.clusters[0].evidence[0].evidence.kind, "changed_file_overlap");
  assert.equal(result.clusters[0].evidence[0].evidence.supersedeGrade, true);
});

test("does not cluster PRs across different bases", () => {
  const result = analyzePrConsolidation([
    pr(10, { workItemKey: "ENG-42", base: "main" }),
    pr(11, { workItemKey: "ENG-42", base: "release/1.x" }),
  ]);
  assert.equal(result.state, "none");
});

test("does not treat lockfile/readme overlap alone as competing implementation evidence", () => {
  const result = analyzePrConsolidation([
    pr(10, { files: ["README.md", "package-lock.json"] }),
    pr(11, { files: ["README.md", "package-lock.json"] }),
  ]);
  assert.equal(result.state, "none");
});

test("same work-item identity alone cannot produce a supersede plan", () => {
  const analysis = analyzePrConsolidation([
    pr(10, { workItemKey: "ENG-42" }),
    pr(11, { workItemKey: "ENG-42" }),
  ]);
  assert.throws(
    () => planPrConsolidation({ analysis, clusterMembers: [10, 11], canonicalPr: 11 }),
    /canonical_pr_missing_supersede_evidence:11:10/,
  );
});

test("a consolidation plan requires an explicit canonical PR with direct implementation overlap", () => {
  const analysis = analyzePrConsolidation([
    pr(10, { workItemKey: "ENG-42", files: ["src/a.mjs", "src/b.mjs"] }),
    pr(11, { workItemKey: "ENG-42", files: ["src/a.mjs", "src/b.mjs", "src/c.mjs"] }),
  ]);
  const plan = planPrConsolidation({ analysis, clusterMembers: [10, 11], canonicalPr: 11 });
  assert.equal(plan.canonicalPr, 11);
  assert.deepEqual(plan.supersede, [{ pr: 10, action: "delegate_supersede_pr", canonicalPr: 11 }]);
  assert.throws(
    () => planPrConsolidation({ analysis, clusterMembers: [10, 11], canonicalPr: 12 }),
    /canonical_pr_not_in_cluster/,
  );
});

test("canonical selection cannot supersede a member connected only transitively", () => {
  const analysis = analyzePrConsolidation([
    pr(10, { workItemKey: "ENG-42", files: ["src/a.mjs", "src/common.mjs"] }),
    pr(11, { workItemKey: "ENG-42", files: ["src/a.mjs", "src/common.mjs", "src/b.mjs", "src/c.mjs"] }),
    pr(12, { files: ["src/b.mjs", "src/c.mjs"] }),
  ]);
  assert.deepEqual(analysis.clusters[0].members, [10, 11, 12]);
  assert.throws(
    () => planPrConsolidation({ analysis, clusterMembers: [10, 11, 12], canonicalPr: 10 }),
    /canonical_pr_missing_supersede_evidence:10:12/,
  );

  const directlyConnectedPlan = planPrConsolidation({
    analysis,
    clusterMembers: [10, 11, 12],
    canonicalPr: 11,
  });
  assert.deepEqual(directlyConnectedPlan.supersede.map((entry) => entry.pr), [10, 12]);
});

test("cannot manufacture a consolidation cluster that analysis did not prove", () => {
  const analysis = analyzePrConsolidation([
    pr(10, { workItemKey: "ENG-42" }),
    pr(11, { workItemKey: "ENG-42" }),
    pr(12),
  ]);
  assert.throws(
    () => planPrConsolidation({ analysis, clusterMembers: [10, 12], canonicalPr: 10 }),
    /consolidation_cluster_not_proven/,
  );
});
