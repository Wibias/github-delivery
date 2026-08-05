import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

test("binds every regression assertion to a marker in an expected resource", () => {
  const report = validateEvalRepository({ root: ROOT });
  assert.equal(report.boundAssertionCount, report.regressionAssertionCount);
  const unbound = report.errors.filter((e) => e.code === "assertion_not_bound");
  const wrongFile = report.errors.filter((e) => e.code === "assertion_not_in_expected_resources");
  const orphans = report.errors.filter((e) => e.code === "assertion_marker_orphan");
  assert.deepEqual(unbound, []);
  assert.deepEqual(wrongFile, []);
  assert.deepEqual(orphans, []);
});

test("executes scope cases and verifies probe-doc binding", () => {
  const report = validateEvalRepository({ root: ROOT });
  assert.ok(report.scopeCaseCount >= 10, "expected scope fixtures");
  assert.ok(report.probeCount >= 10, "expected probe registry entries");
  const scopeFailures = report.errors.filter((e) => e.code === "scope_case_probe_mismatch");
  const docFailures = report.errors.filter((e) =>
    ["probe_not_tagged_in_docs", "probe_assertion_not_bound", "probe_assertion_wrong_doc"].includes(e.code),
  );
  const registryFailures = report.errors.filter((e) => e.code === "probe_registry_invalid");
  assert.deepEqual(scopeFailures, []);
  assert.deepEqual(docFailures, []);
  assert.deepEqual(registryFailures, []);
});

function makeFixtureRoot() {
  const dir = mkdtempSync(join(tmpdir(), "eval-contracts-"));
  mkdirSync(join(dir, "tests", "evals"), { recursive: true });
  mkdirSync(join(dir, "references"), { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    [
      "# Skill",
      "Read shared-rules before acting.",
      "<!-- assertion: keeps-rule -->",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(dir, "references", "shared-rules.md"),
    ["# Shared rules", "Keep fixing until merge-ready."].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(dir, "references", "merge-pr.md"),
    ["# Merge", "Merge bottom-up."].join("\n"),
    "utf8",
  );
  const caseRow = (id, assertionIds, expectedResources) =>
    JSON.stringify({
      id,
      category: "regression",
      invocation: "implicit",
      prompt: "Full review PR #42.",
      expected_skill: "github-delivery",
      expected_resources: expectedResources,
      unnecessary_resources: [],
      assertion_ids: assertionIds,
      scenario: "test fixture",
      added: "2026-08-05",
    });
  writeFileSync(
    join(dir, "tests", "evals", "regression-cases.jsonl"),
    [
      caseRow("R-fixture-bound", ["keeps-rule"], ["SKILL.md", "references/shared-rules.md"]),
      caseRow("R-fixture-unbound", ["no-such-rule"], ["SKILL.md", "references/shared-rules.md"]),
      caseRow(
        "R-fixture-wrong-file",
        ["keeps-rule"],
        ["references/merge-pr.md"], // marker lives in SKILL.md, not listed
      ),
    ].join("\n") + "\n",
    "utf8",
  );
  writeFileSync(join(dir, "tests", "evals", "regression-lock.json"), "[]\n", "utf8");
  // A minimal probe-tagged doc so validateProbeDocBinding has a home for the
  // probe assertions the registry requires; scope fixtures reuse the real
  // registry (assertion ids must belong to a real probe). To keep the minimal
  // fixture green, every probe in the registry must be tagged here too.
  const probeDocs = [
    ["api-cli-wiring", ["wiring-trace-required", "operator-smoke-required", "green-tests-not-enough"]],
    ["input-shape-evidence-semantics", ["real-shape-required", "unknown-not-false", "nested-source-evidence"]],
    ["determinism-clocks-budgets", ["one-decision-one-clock", "filter-before-limit", "byte-budget-required"]],
    ["recursion-termination", ["recursion-termination-required", "alias-namespace-shadow"]],
    ["cli-payload-completeness", ["cli-payload-completeness"]],
    ["hot-path-scale", ["hot-path-scale-required"]],
    ["malformed-input-robustness", ["malformed-input-robustness", "db-result-cast-boundary"]],
    ["lock-error-propagation", ["complementary-must-probe", "typed-catch-detached"]],
    ["credential-transport", ["oauth-token-no-cleartext", "baseurl-https-only-credential-provider"]],
    ["secrets-scan", ["secrets-scan"]],
    ["removed-controls", ["removed-controls-leads"]],
  ];
  writeFileSync(
    join(dir, "references", "bug-review.md"),
    [
      "# Bug review",
      ...probeDocs.flatMap(([probe, assertions]) => [
        `<!-- probe: ${probe} -->`,
        ...assertions.map((a) => `<!-- assertion: ${a} -->`),
      ]),
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(dir, "tests", "evals", "scope-cases.jsonl"),
    JSON.stringify({
      id: "SCOPE-fixture",
      category: "scope",
      prompt: "CLI flag diff",
      files: [
        { path: "cli/route-policy.ts", patch: "+const args = process.argv.slice(2);\n+const id = args.shift();\n+if (id === '--json') { showUsage(); }", status: "modified", additions: 3, deletions: 0 },
      ],
      expected_probes: ["api-cli-wiring"],
      scenario: "test fixture",
      added: "2026-08-05",
    }) + "\n",
    "utf8",
  );
  return dir;
}

test("binding check reports unbound, wrong-file, and marker presence", () => {
  const dir = makeFixtureRoot();
  try {
    const report = validateEvalRepository({ root: dir });
    assert.equal(report.valid, false);
    const codes = report.errors.map((e) => e.code).sort();
    // unbound + wrong-file are expected; no orphans (marker used by fixture)
    assert.ok(codes.includes("assertion_not_bound"), JSON.stringify(report.errors));
    assert.ok(codes.includes("assertion_not_in_expected_resources"), JSON.stringify(report.errors));
    assert.ok(!codes.includes("assertion_marker_orphan"), JSON.stringify(report.errors));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("binding check reports orphan markers and fails on marker deletion (drift)", () => {
  const dir = makeFixtureRoot();
  try {
    // Remove the marker so the bound case now drifts (simulates probe deletion)
    const skill = "Skill with no marker";
    writeFileSync(join(dir, "SKILL.md"), skill, "utf8");
    const report = validateEvalRepository({ root: dir });
    assert.equal(report.valid, false);
    const codes = report.errors.map((e) => e.code);
    assert.ok(codes.includes("assertion_not_bound"), JSON.stringify(report.errors));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scope-case probe mismatch is reported when a trigger drifts", () => {
  const dir = makeFixtureRoot();
  try {
    // Point the fixture at a probe the diff no longer triggers (drift)
    const path = join(dir, "tests", "evals", "scope-cases.jsonl");
    const row = JSON.parse(readFileSync(path, "utf8"));
    row.expected_probes = ["hot-path-scale"]; // the CLI-flag diff does not trigger this
    writeFileSync(path, JSON.stringify(row) + "\n", "utf8");
    const report = validateEvalRepository({ root: dir });
    assert.equal(report.valid, false);
    const mismatch = report.errors.find((e) => e.code === "scope_case_probe_mismatch");
    assert.ok(mismatch, JSON.stringify(report.errors));
    assert.equal(mismatch.id, "SCOPE-fixture");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
