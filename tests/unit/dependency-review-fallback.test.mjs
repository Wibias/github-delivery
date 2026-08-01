import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { evaluateDependencyReviewFallback } from "../../scripts/lib/dependency-review-fallback.mjs";

function fixture(packageJson = { name: "fixture", version: "1.0.0" }) {
  const root = mkdtempSync(join(tmpdir(), "shipping-github-dependency-review-"));
  writeFileSync(join(root, "package.json"), JSON.stringify(packageJson, null, 2) + "\n");
  return root;
}

test("uses GitHub dependency review as authoritative when it succeeds", () => {
  const report = evaluateDependencyReviewFallback({ outcome: "success", root: fixture({ dependencies: { risky: "1.0.0" } }) });
  assert.equal(report.decision, "authoritative_pass");
  assert.equal(report.degraded, false);
});

test("permits a degraded pass only for a dependency-free repository", () => {
  const report = evaluateDependencyReviewFallback({ outcome: "failure", root: fixture() });
  assert.equal(report.decision, "dependency_free_degraded_pass");
  assert.equal(report.degraded, true);
  assert.deepEqual(report.dependencies, []);
  assert.deepEqual(report.lockfiles, []);
});

test("fails closed when a manifest declares dependencies", () => {
  const root = fixture({ name: "fixture", version: "1.0.0", devDependencies: { test: "1.0.0" } });
  const report = evaluateDependencyReviewFallback({ outcome: "failure", root });
  assert.equal(report.decision, "blocked");
  assert.equal(report.dependencies[0].name, "test");
});

test("fails closed when a lockfile exists", () => {
  const root = fixture();
  writeFileSync(join(root, "package-lock.json"), "{}\n");
  const report = evaluateDependencyReviewFallback({ outcome: "failure", root });
  assert.equal(report.decision, "blocked");
  assert.deepEqual(report.lockfiles, ["package-lock.json"]);
});
