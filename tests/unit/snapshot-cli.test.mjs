import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "../..");

function source(required = true) {
  return { required, readable: true, complete: true, error: null };
}

function writeSnapshot() {
  const directory = mkdtempSync(join(tmpdir(), "shipping-github-cli-"));
  const path = join(directory, "snapshot.json");
  const snapshot = {
    schemaVersion: 1,
    kind: "shipping-github/evidence-snapshot",
    snapshotId: "cli-snapshot",
    capturedAt: "2026-08-01T00:00:00.000Z",
    repo: "Wibias/shipping-github",
    pr: 42,
    headOid: "head123",
    complete: true,
    incompleteReasons: [],
    sources: {
      pr: source(),
      changedFiles: source(),
      activeRules: source(),
      checkRuns: source(),
      statuses: source(),
      issueComments: source(),
      reviewComments: source(),
      reviews: source(),
      reviewThreads: source(),
      branchProtection: source(false),
      codeowners: source(false),
      codeownersErrors: source(false),
      policyGraphql: source(),
      workflowCoverage: source(),
      viewer: source(),
    },
    evidence: {
      pullRequest: {
        number: 42,
        url: "https://github.com/Wibias/shipping-github/pull/42",
        baseRefName: "main",
        headRefOid: "head123",
        mergeStateStatus: "CLEAN",
        mergeable: "MERGEABLE",
        reviewDecision: "APPROVED",
        isDraft: false,
        reviewRequests: [],
        commits: [],
      },
      changedFiles: [{ filename: "src/index.mjs" }],
      branchProtection: null,
      activeRules: [],
      checks: { checkRuns: [], statuses: [] },
      feedback: {
        issueComments: [],
        reviewComments: [],
        reviews: [],
        reviewThreads: [],
      },
      codeowners: {
        path: ".github/CODEOWNERS",
        text: "src/** @maintainers\n",
        errors: [],
      },
      policy: {
        branchProtectionRules: {
          pageInfo: { hasNextPage: false },
          nodes: [],
        },
        latestOpinionatedReviews: {
          pageInfo: { hasNextPage: false },
          nodes: [],
        },
        mergeQueue: { enabled: false, inQueue: false, entry: null },
      },
      workflowCoverage: {
        complete: true,
        scannedRef: "main",
        workflowFiles: 1,
        hasPullRequestTrigger: true,
        hasMergeGroupTrigger: false,
        warning: null,
      },
      viewer: { login: "Wibias" },
    },
  };
  writeFileSync(path, JSON.stringify(snapshot), "utf8");
  return path;
}

for (const script of [
  "required-checks.mjs",
  "pr-policy-gate.mjs",
  "review-threads.mjs",
  "codeowners-for-pr.mjs",
  "watch-wake-gate.mjs",
]) {
  test(`${script} evaluates a snapshot without invoking gh`, () => {
    const path = writeSnapshot();
    const result = spawnSync(
      process.execPath,
      [
        join(ROOT, "scripts", script),
        "Wibias/shipping-github",
        "42",
        "--snapshot",
        path,
        "--expected-head",
        "head123",
        "--max-age-seconds",
        "999999999",
      ],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: { ...process.env, PATH: "" },
      },
    );
    assert.equal(
      result.status,
      0,
      `${script}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
    const output = JSON.parse(result.stdout);
    assert.equal(output.snapshotId, "cli-snapshot");
  });
}
