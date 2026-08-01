import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { validateEvalRepository } from "../../scripts/lib/eval-contracts.mjs";

const ROOT = resolve(import.meta.dirname, "../..");

test("validates schemas, references, routes, and regression locks", () => {
  const report = validateEvalRepository({ root: ROOT });
  assert.equal(report.valid, true, JSON.stringify(report.errors, null, 2));
  assert.ok(report.caseCount > 10);
  assert.ok(report.regressionCount > 10);
  assert.ok(report.routeChecks > 5);
  assert.deepEqual(report.errors, []);
});

test("includes the natural-language merge route in executable cases", () => {
  const report = validateEvalRepository({ root: ROOT });
  const merge = report.routes.find((row) => row.id === "ROUTE-merge-pr-natural-language");
  assert.ok(merge);
  assert.equal(merge.actualWorkflow, "references/merge-pr.md");
  assert.equal(merge.mutationMode, "maintainer");
});
