import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

function occurrences(text, needle) {
  return text.split(needle).length - 1;
}

const ci = read(".github/workflows/ci.yml");
const codeql = read(".github/workflows/codeql.yml");
const dependencyReview = read(".github/workflows/dependency-review.yml");
const repositoryPolicyWorkflow = read(".github/workflows/repository-policy.yml");
const cleanupWorkflow = read(".github/workflows/cleanup-orphaned-workflows.yml");
const repositoryPolicy = JSON.parse(read(".github/repository-policy.json"));

test("pull-request CI keeps one canonical full check and bounded compatibility lanes", () => {
  assert.equal(occurrences(ci, "npm run check"), 1);
  assert.doesNotMatch(ci, /macos-latest/);
  assert.doesNotMatch(ci, /\bmatrix:/);
  assert.match(ci, /name: Node 24 \/ ubuntu-latest/);
  assert.match(ci, /name: Node 22 \/ ubuntu-latest/);
  assert.match(ci, /name: Node 24 \/ windows-latest/);
  assert.match(ci, /node-version: 26/);
  assert.match(ci, /node scripts\/check-syntax\.mjs && npm run package:check && npm test/);
  assert.match(ci, /cancel-in-progress: true/);
});

test("compatibility and Windows lanes use NUL-safe scope evidence and fail closed if detection fails", () => {
  assert.match(ci, /scope:/);
  assert.match(ci, /node_compat:/);
  assert.match(ci, /windows_authority:/);
  assert.match(ci, /git diff --name-only -z/);
  assert.match(ci, /node scripts\/ci-scope\.mjs --mode ci/);
  assert.match(ci, /needs: scope/);
  assert.match(ci, /needs\.scope\.result != 'success'/);
  assert.match(ci, /needs\.scope\.outputs\.node_compat == 'true'/);
  assert.match(ci, /needs\.scope\.outputs\.windows_authority == 'true'/);
  assert.ok(occurrences(ci, "Fail closed when scope detection failed") >= 2);
  assert.match(ci, /authority-host\/windows\//);
  assert.match(ci, /scripts\/prepare-authority-host-runtime-smoke\.mjs/);
});

test("live fixture diffs force compatibility lanes for acceptance coverage", () => {
  assert.match(read("scripts/ci-scope.mjs"), /\.github-delivery-fixtures/);
});

test("repository policy requires only the lean CI lanes", () => {
  const ciChecks = repositoryPolicy.requiredChecks.filter((name) => name.startsWith("Node "));
  assert.deepEqual(ciChecks, [
    "Node 22 / ubuntu-latest",
    "Node 24 / ubuntu-latest",
    "Node 24 / windows-latest",
  ]);
});

test("repository policy PRs can migrate live rulesets without self-blocking", () => {
  assert.match(repositoryPolicyWorkflow, /fetch-depth: 0/);
  assert.match(repositoryPolicyWorkflow, /BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(
    repositoryPolicyWorkflow,
    /if node scripts\/verify-live-repository-policy\.mjs "\$\{GITHUB_REPOSITORY\}"; then/,
  );
  assert.match(
    repositoryPolicyWorkflow,
    /git show "\$\{BASE_SHA\}:\.github\/repository-policy\.json"/,
  );
});

test("architecture contracts are not duplicated in a separate PR workflow", () => {
  assert.equal(
    existsSync(new URL("../../.github/workflows/architecture-contracts.yml", import.meta.url)),
    false,
  );
  assert.match(ci, /npm run check/);
});

test("superseded expensive PR workflows cancel in progress", () => {
  for (const [name, workflow] of [
    ["CI", ci],
    ["CodeQL", codeql],
    ["Dependency Review", dependencyReview],
  ]) {
    assert.match(workflow, /concurrency:/, name);
    assert.match(workflow, /cancel-in-progress: true/, name);
  }
});

test("C# CodeQL uses NUL-safe scope evidence and fails closed on scope errors", () => {
  assert.match(codeql, /csharp_scope:/);
  assert.match(codeql, /git diff --name-only -z/);
  assert.match(codeql, /node scripts\/ci-scope\.mjs --mode csharp/);
  assert.match(codeql, /authority-host\/windows\//);
  assert.match(codeql, /needs: csharp_scope/);
  assert.match(codeql, /needs\.csharp_scope\.result != 'success'/);
  assert.match(codeql, /needs\.csharp_scope\.outputs\.required == 'true'/);
  assert.match(codeql, /Fail closed when C# scope detection failed/);
});

test("maintenance schedules stay bounded", () => {
  assert.match(repositoryPolicyWorkflow, /cron: "17 4 \* \* \*"/);
  assert.doesNotMatch(repositoryPolicyWorkflow, /\*\/6/);
  assert.match(cleanupWorkflow, /cron: "0 6 \* \* 1"/);
});
