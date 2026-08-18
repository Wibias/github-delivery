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

test("compatibility and Windows lanes skip irrelevant pull-request diffs", () => {
  assert.match(ci, /scope:/);
  assert.match(ci, /node_compat:/);
  assert.match(ci, /windows_authority:/);
  assert.match(ci, /needs: scope/);
  assert.match(ci, /needs\.scope\.outputs\.node_compat == 'true'/);
  assert.match(ci, /needs\.scope\.outputs\.windows_authority == 'true'/);
  assert.match(ci, /authority-host\/windows\//);
  assert.match(ci, /scripts\/prepare-authority-host-runtime-smoke\.mjs/);
});

test("repository policy requires only the lean CI lanes", () => {
  const ciChecks = repositoryPolicy.requiredChecks.filter((name) => name.startsWith("Node "));
  assert.deepEqual(ciChecks, [
    "Node 22 / ubuntu-latest",
    "Node 24 / ubuntu-latest",
    "Node 24 / windows-latest",
  ]);
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

test("C# CodeQL is conditional for pull requests but remains required when relevant", () => {
  assert.match(codeql, /csharp_scope:/);
  assert.match(codeql, /authority-host\/windows\//);
  assert.match(codeql, /needs: csharp_scope/);
  assert.match(codeql, /github\.event_name != 'pull_request' \|\| needs\.csharp_scope\.outputs\.required == 'true'/);
});

test("maintenance schedules stay bounded", () => {
  assert.match(repositoryPolicyWorkflow, /cron: "17 4 \* \* \*"/);
  assert.doesNotMatch(repositoryPolicyWorkflow, /\*\/6/);
  assert.match(cleanupWorkflow, /cron: "0 6 \* \* 1"/);
});
