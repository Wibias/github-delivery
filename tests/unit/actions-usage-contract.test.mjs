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

test("Node compatibility and Windows Authority lanes are scoped from the PR base classifier", () => {
  assert.match(ci, /scope:/);
  assert.match(ci, /node_compat:/);
  assert.match(ci, /windows_authority:/);
  assert.match(ci, /git show "\$\{BASE_SHA\}:scripts\/ci-scope\.mjs"/);
  assert.match(ci, /git diff --name-only -z/);
  assert.match(ci, /node "\$\{TRUSTED_SCOPE\}" --mode ci/);
  assert.match(ci, /needs\.scope\.outputs\.node_compat == 'true'/);

  const windowsBlock = ci.slice(ci.indexOf("  windows-authority:"));
  assert.match(windowsBlock, /needs: scope/);
  assert.match(windowsBlock, /needs\.scope\.outputs\.windows_authority == 'true'/);
  assert.match(windowsBlock, /Fail closed when scope detection failed/);
  assert.match(windowsBlock, /authority-host\/windows\//);
  assert.match(windowsBlock, /scripts\/prepare-authority-host-runtime-smoke\.mjs/);
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

test("repository policy live verify prefers an admin token over github.token", () => {
  assert.match(
    repositoryPolicyWorkflow,
    /GH_TOKEN: \$\{\{ secrets\.REPOSITORY_POLICY_TOKEN \|\| github\.token \}\}/,
  );
});

test("repository policy pull-request CI receives EVENT_NAME for bypass-attestation gating", () => {
  assert.match(repositoryPolicyWorkflow, /EVENT_NAME: \$\{\{ github\.event_name \}\}/);
  assert.match(
    read("scripts/verify-live-repository-policy.mjs"),
    /liveRepositoryPolicyCiExitCode\(report, \{\s*eventName: process\.env\.EVENT_NAME/,
  );
});

test("repository policy live verify reads tag rulesets for the declared protected pattern", () => {
  const source = read("scripts/verify-live-repository-policy.mjs");
  assert.match(source, /repos\/\$\{repo\}\/rulesets\?per_page=100/);
  assert.match(source, /target !== "tag"/);
  assert.match(source, /tagRulesetsComplete/);
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

test("CodeQL init, autobuild, and analyze stay on the same pinned SHA", () => {
  const pins = [...codeql.matchAll(/github\/codeql-action\/(init|autobuild|analyze)@([0-9a-f]{40})/g)];
  const byAction = { init: [], autobuild: [], analyze: [] };
  for (const match of pins) byAction[match[1]].push(match[2]);
  assert.ok(byAction.init.length >= 1, "missing init pin");
  assert.ok(byAction.autobuild.length >= 1, "missing autobuild pin");
  assert.ok(byAction.analyze.length >= 1, "missing analyze pin");
  const shas = new Set(pins.map((match) => match[2]));
  assert.equal(shas.size, 1, `mixed CodeQL action SHAs: ${[...shas].join(", ")}`);
});

test("Dependabot groups github/codeql-action updates", () => {
  const dependabot = read(".github/dependabot.yml");
  assert.match(dependabot, /package-ecosystem: github-actions[\s\S]*groups:\s*\n\s*codeql-action:\s*\n\s*patterns:\s*\n\s*- "github\/codeql-action\*"/);
});

test("CodeQL analyses are scoped from the PR base classifier and fail closed", () => {
  assert.match(codeql, /node "\$\{TRUSTED_SCOPE\}" --mode codeql/);
  assert.match(codeql, /git show "\$\{BASE_SHA\}:scripts\/ci-scope\.mjs"/);
  assert.match(codeql, /needs\.scope\.outputs\.javascript == 'true'/);
  assert.match(codeql, /analyze-csharp:/);
  assert.match(codeql, /name: CodeQL \/ Analyze \(csharp\)/);
  const csharpBlock = codeql.slice(codeql.indexOf("  analyze-csharp:"));
  assert.match(csharpBlock, /needs: scope/);
  assert.match(csharpBlock, /needs\.scope\.outputs\.csharp == 'true'/);
  assert.match(csharpBlock, /Fail closed when C# scope detection failed/);
  assert.match(csharpBlock, /authority-host\/windows\//);
});

test("Windows rewrite-baseline CI is path-filtered to the files it exercises", () => {
  const rewrite = read(".github/workflows/windows-rewrite-baseline.yml");
  assert.match(rewrite, /paths:/);
  assert.match(rewrite, /scripts\/lib\/rewrite-baseline-store\.mjs/);
  assert.match(rewrite, /tests\/unit\/push-cleanup-convergence\.test\.mjs/);
});

test("maintenance schedules stay bounded", () => {
  assert.match(repositoryPolicyWorkflow, /cron: "17 4 \* \* \*"/);
  assert.doesNotMatch(repositoryPolicyWorkflow, /\*\/6/);
  assert.match(cleanupWorkflow, /cron: "0 6 \* \* 1"/);
});
