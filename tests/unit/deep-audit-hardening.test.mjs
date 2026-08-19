import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { classifyCiScope } from "../../scripts/ci-scope.mjs";
import { cleanupOrphanedWorkflowRuns } from "../../scripts/cleanup-orphaned-workflows.mjs";
import { makeRedemptionRunner } from "../../scripts/lib/authority-execution.mjs";
import {
  collectBranchReviewInput,
  planReviewScope,
} from "../../scripts/lib/review-scope.mjs";
import { evaluate as evaluatePreOpen } from "../../scripts/pre-open-gate.mjs";
import { briefText } from "../../scripts/review-brief.mjs";

function source(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

test("CI scope policy changes force the Windows and C# security lanes", () => {
  const scope = classifyCiScope(["scripts/ci-scope.mjs"]);
  assert.equal(scope.nodeCompat, true);
  assert.equal(scope.windowsAuthority, true);
  assert.equal(scope.csharp, true);
});

test("PR scope detection executes the trusted base selector, not candidate code", () => {
  const ci = source(".github/workflows/ci.yml");
  const codeql = source(".github/workflows/codeql.yml");
  const trustedSelector = /git show \"\$\{BASE_SHA\}:scripts\/ci-scope\.mjs\"/;

  assert.match(ci, trustedSelector);
  assert.match(codeql, trustedSelector);
  assert.doesNotMatch(
    ci,
    /git diff --name-only -z \"\$\{BASE_SHA\}\"\.\.\.HEAD \|\s*\n\s*node scripts\/ci-scope\.mjs/,
  );
  assert.doesNotMatch(
    codeql,
    /git diff --name-only -z \"\$\{BASE_SHA\}\"\.\.\.HEAD \|\s*\n\s*node scripts\/ci-scope\.mjs/,
  );
});

test("trusted authority is redeemed before an internal coordination write executes", () => {
  const events = [];
  const nonce = "audit-nonce";
  const authority = {
    verified: true,
    claims: {
      redemption: "required",
      scopeSha256: "a".repeat(64),
      nonce,
    },
  };
  const execution = makeRedemptionRunner({
    plannedCommand: ["gh", "pr", "comment", "42"],
    authority,
    authorityGrant: "gd1.audit-fixture",
    redeemer() {
      events.push("redeem");
      return { status: "consumed", nonce, consumedAt: 1 };
    },
    runner() {
      events.push("write");
      return { status: 0, stdout: "", stderr: "" };
    },
  });

  execution.runner("gh", [
    "api",
    "repos/acme/widget/git/refs",
    "--method",
    "POST",
    "-f",
    "ref=refs/github-delivery/idempotency/test",
    "-f",
    `sha=${"b".repeat(40)}`,
  ], {});

  assert.deepEqual(events, ["redeem", "write"]);
  assert.equal(execution.redemption()?.status, "consumed");
});

test("branch review input preserves rename source and destination paths", () => {
  const root = mkdtempSync(join(tmpdir(), "github-delivery-rename-"));
  const previousCwd = process.cwd();
  try {
    git(root, ["init", "-b", "main"]);
    git(root, ["config", "user.email", "audit@example.invalid"]);
    git(root, ["config", "user.name", "Audit Fixture"]);
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "auth.mjs"), "export const auth = true;\n", "utf8");
    git(root, ["add", "src/auth.mjs"]);
    git(root, ["commit", "-m", "base"]);
    const base = git(root, ["rev-parse", "HEAD"]);

    git(root, ["mv", "src/auth.mjs", "src/auth"]);
    git(root, ["commit", "-m", "rename auth module"]);
    const head = git(root, ["rev-parse", "HEAD"]);

    process.chdir(root);
    const input = collectBranchReviewInput(base, head);
    assert.equal(input.files.length, 1);
    assert.equal(input.files[0].status.startsWith("R"), true);
    assert.equal(input.files[0].previousPath, "src/auth.mjs");
    assert.equal(input.files[0].path, "src/auth");
  } finally {
    process.chdir(previousCwd);
    rmSync(root, { recursive: true, force: true });
  }
});

test("pre-open gate blocks until every deterministic required probe has evidence", () => {
  const plan = planReviewScope({
    repo: "acme/widget",
    pr: null,
    headRefOid: "abc",
    files: [
      {
        path: "tests/worker.test.mjs",
        patch: "+setTimeout(() => {}, 100);\n",
        additions: 1,
        deletions: 0,
        status: "modified",
      },
    ],
  });
  assert.ok(plan.requiredProbes.includes("test-honesty"));

  const first = evaluatePreOpen(plan);
  const evidence = {
    schemaVersion: 1,
    lenses: Object.fromEntries(first.bugScope.requiredLenses.map((id) => [id, "done"])),
    surfaces: Object.fromEntries(
      first.securityScope.requiredSurfaces.map((id) => [id, "n/a audit fixture boundary untouched"]),
    ),
    probes: {},
  };
  const result = evaluatePreOpen(plan, evidence);

  assert.equal(result.decision, "blocked");
  assert.ok(result.blockers.includes("probe:requiredProbes:test-honesty"));
});

test("merge driver enforces stack-parent eligibility as an executable precondition", () => {
  const mergeDriver = source("scripts/merge-pr-driver.mjs");
  assert.match(mergeDriver, /verifyMergeStackEligibility/);
  assert.match(mergeDriver, /stack_parent_unlanded/);
});

test("orphan cleanup aborts if the default branch generation moves before deletion", async () => {
  const calls = [];
  let refReads = 0;
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const method = init.method ?? "GET";
    const path = `${url.pathname}${url.search}`;
    calls.push(`${method} ${path}`);

    if (method === "GET" && path === "/repos/Wibias/github-delivery") {
      return Response.json({ default_branch: "main" });
    }
    if (method === "GET" && path === "/repos/Wibias/github-delivery/git/ref/heads/main") {
      refReads += 1;
      return Response.json({ object: { sha: refReads === 1 ? "a".repeat(40) : "b".repeat(40) } });
    }
    if (
      method === "GET" &&
      path === "/repos/Wibias/github-delivery/contents/.github/workflows?ref=main"
    ) {
      return Response.json([
        { type: "file", path: ".github/workflows/ci.yml" },
        { type: "file", path: ".github/workflows/cleanup-orphaned-workflows.yml" },
      ]);
    }
    if (
      method === "GET" &&
      path === "/repos/Wibias/github-delivery/actions/workflows?per_page=100&page=1"
    ) {
      return Response.json({
        workflows: [
          { id: 2, name: "Old helper", path: ".github/workflows/tmp.yml" },
        ],
      });
    }
    if (
      method === "GET" &&
      path === "/repos/Wibias/github-delivery/actions/workflows/2/runs?per_page=100&page=1"
    ) {
      return Response.json({ workflow_runs: [{ id: 200, status: "completed" }] });
    }
    if (method === "DELETE") {
      return new Response("delete should not be attempted after generation drift", { status: 500 });
    }
    return new Response(`Unexpected request: ${method} ${path}`, { status: 500 });
  };

  await assert.rejects(
    cleanupOrphanedWorkflowRuns({
      token: "test-token",
      repository: "Wibias/github-delivery",
      fetchImpl,
      log: () => {},
    }),
    /default_branch_moved_during_cleanup/,
  );
  assert.equal(calls.some((call) => call.startsWith("DELETE ")), false);
  assert.equal(refReads, 2);
});

test("review brief applies a global hunk-line budget across huge diffs", () => {
  const files = Array.from({ length: 20 }, (_, index) => ({
    path: `src/file-${index}.mjs`,
    additions: 30,
    deletions: 0,
    patch: Array.from({ length: 30 }, (__, line) => `+line ${index}-${line}`).join("\n"),
  }));
  const text = briefText({
    meta: { repo: "acme/widget", pr: 1 },
    plan: {
      headRefOid: "abc",
      fileCount: files.length,
      logicFiles: files.map((file) => file.path),
      requiredProbes: [],
      dependencyChanges: [],
      removedControlLeads: [],
      uncertainty: [],
    },
    files,
    bugScope: { requiredLenses: [] },
    securityScope: { requiredSurfaces: [] },
    executionPlan: null,
    maxHunkLines: 24,
    maxTotalHunkLines: 50,
    probeBlocks: [],
  });

  const emittedDiffLines = text.split(/\r?\n/).filter((line) => line.startsWith("+line "));
  assert.ok(emittedDiffLines.length <= 50, `expected <= 50 hunk lines, got ${emittedDiffLines.length}`);
  assert.match(text, /global hunk budget/i);
});
