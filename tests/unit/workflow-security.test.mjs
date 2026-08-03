import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  validateRepositoryPolicy,
  validateWorkflowFile,
  validateWorkflowTree,
} from "../../scripts/lib/workflow-security.mjs";

function workflowRoot(source) {
  const root = mkdtempSync(join(tmpdir(), "github-delivery-workflow-policy-"));
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(join(root, ".github", "workflows", "fixture.yml"), source);
  return root;
}

test("repository workflows satisfy the security policy", () => {
  const report = validateWorkflowTree(process.cwd());
  assert.equal(report.valid, true, JSON.stringify(report.errors, null, 2));
  assert(report.files.includes(".github/workflows/release.yml"));
});

test("rejects unpinned actions and pull_request_target", () => {
  const source = `name: Bad\non:\n  pull_request_target:\npermissions:\n  contents: read\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v6\n`;
  const errors = validateWorkflowFile(".github/workflows/bad.yml", source);
  assert(errors.some((error) => error.code === "pull_request_target_forbidden"));
  assert(errors.some((error) => error.code === "action_not_pinned"));
});

test("rejects checkout with persisted credentials", () => {
  const source = `name: Bad\non:\n  pull_request:\npermissions:\n  contents: read\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@${"a".repeat(40)}\n`;
  const errors = validateWorkflowFile(".github/workflows/bad.yml", source);
  assert(errors.some((error) => error.code === "checkout_credentials_not_disabled"));
});

test("rejects write permissions outside approved workflows", () => {
  const source = `name: Bad\non:\n  push:\npermissions:\n  contents: write\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@${"a".repeat(40)}\n        with:\n          persist-credentials: false\n`;
  const errors = validateWorkflowFile(".github/workflows/bad.yml", source);
  assert(errors.some((error) => error.code === "write_permission_not_allowed"));
});

test("desired repository policy is fail-closed", () => {
  const policy = {
    schemaVersion: 1,
    defaultBranch: "main",
    pullRequests: { required: true, conversationResolution: true, dismissStaleApprovals: true },
    branch: { allowForcePushes: false, allowDeletions: false, requireLinearHistory: false },
    merge: { methods: ["merge"], updateBranch: true, autoMerge: true },
    release: { environment: "release", protectedTagPattern: "v*", requiredReviewers: 1 },
    requiredChecks: ["Node 20 / ubuntu-latest", "Dependency Review", "CodeQL"],
  };
  assert.deepEqual(validateRepositoryPolicy(policy), []);
  policy.merge.methods = ["merge", "squash"];
  assert.match(validateRepositoryPolicy(policy)[0].code, /merge_method/);
});
