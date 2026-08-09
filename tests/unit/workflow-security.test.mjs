import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  evaluateLiveRepositoryPolicy,
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

function desiredPolicy() {
  return {
    schemaVersion: 1,
    defaultBranch: "main",
    pullRequests: {
      required: true,
      conversationResolution: true,
      dismissStaleApprovals: true,
    },
    branch: {
      allowForcePushes: false,
      allowDeletions: false,
      requireLinearHistory: false,
    },
    merge: { methods: ["merge"], updateBranch: true, autoMerge: true },
    release: {
      environment: "release",
      protectedTagPattern: "v*",
      requiredReviewers: 1,
    },
    requiredChecks: [
      "Node 22 / ubuntu-latest",
      "Dependency Review",
      "CodeQL / Analyze (javascript-typescript)",
    ],
  };
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

test("quoted YAML keys cannot bypass pull_request_target or write checks", () => {
  const source = `name: Bad\n'on':\n  'pull_request_target':\n'permissions':\n  'contents': write\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - 'uses': 'actions/checkout@v6'\n`;
  const errors = validateWorkflowFile(".github/workflows/bad.yml", source);
  assert(errors.some((error) => error.code === "pull_request_target_forbidden"));
  assert(errors.some((error) => error.code === "write_permission_not_allowed"));
  assert(errors.some((error) => error.code === "action_not_pinned"));
});

test("inline trigger and permissions mappings are inspected semantically", () => {
  const source = `name: Bad\non: [push, 'pull_request_target']\npermissions: { contents: write }\njobs:\n  test:\n    runs-on: ubuntu-latest\n`;
  const errors = validateWorkflowFile(".github/workflows/bad.yml", source);
  assert(errors.some((error) => error.code === "pull_request_target_forbidden"));
  assert(errors.some((error) => error.code === "write_permission_not_allowed"));
});

test("unsupported YAML indirection fails closed", () => {
  const source = `name: Bad\non:\n  push:\npermissions: *privileged\njobs:\n  test:\n    runs-on: ubuntu-latest\n`;
  const errors = validateWorkflowFile(".github/workflows/bad.yml", source);
  assert(errors.some((error) => error.code === "workflow_yaml_unsupported"));
});

test("rejects checkout with persisted credentials", () => {
  const source = `name: Bad\non:\n  pull_request:\npermissions:\n  contents: read\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@${"a".repeat(40)}\n`;
  const errors = validateWorkflowFile(".github/workflows/bad.yml", source);
  assert(errors.some((error) => error.code === "checkout_credentials_not_disabled"));
});

test("accepts checkout only when its own step disables credential persistence", () => {
  const source = `name: Good\non:\n  pull_request:\npermissions:\n  contents: read\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@${"a".repeat(40)}\n        with:\n          persist-credentials: false\n      - run: echo ok\n`;
  const errors = validateWorkflowFile(".github/workflows/good.yml", source);
  assert.equal(
    errors.some((error) => error.code === "checkout_credentials_not_disabled"),
    false,
  );
});

test("rejects write permissions outside approved workflows", () => {
  const source = `name: Bad\non:\n  push:\npermissions:\n  contents: write\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@${"a".repeat(40)}\n        with:\n          persist-credentials: false\n`;
  const errors = validateWorkflowFile(".github/workflows/bad.yml", source);
  assert(errors.some((error) => error.code === "write_permission_not_allowed"));
});

test("desired repository policy is fail-closed", () => {
  const policy = desiredPolicy();
  assert.deepEqual(validateRepositoryPolicy(policy), []);
  policy.merge.methods = ["merge", "squash"];
  assert.match(validateRepositoryPolicy(policy)[0].code, /merge_method/);
});

test("live policy drift detects an unprotected default branch and missing release reviewer", () => {
  const report = evaluateLiveRepositoryPolicy({
    policy: desiredPolicy(),
    live: {
      repository: { default_branch: "main" },
      branch: { name: "main", protected: false },
      activeRules: [],
      releaseEnvironment: { name: "release", protection_rules: [] },
    },
  });
  assert.equal(report.valid, false);
  assert.ok(report.errors.some((error) => error.code === "default_branch_unprotected"));
  assert.ok(report.errors.some((error) => error.code === "active_rules_missing"));
  assert.ok(report.errors.some((error) => error.code === "release_reviewer_missing"));
});

test("live policy drift reports missing required check contexts", () => {
  const report = evaluateLiveRepositoryPolicy({
    policy: desiredPolicy(),
    live: {
      repository: { default_branch: "main" },
      branch: { name: "main", protected: true },
      activeRules: [
        { type: "pull_request" },
        {
          type: "required_status_checks",
          parameters: {
            required_status_checks: [
              { context: "Node 22 / ubuntu-latest" },
              { context: "Dependency Review" },
            ],
          },
        },
      ],
      releaseEnvironment: {
        name: "release",
        protection_rules: [
          { type: "required_reviewers", reviewers: [{ reviewer: { login: "maintainer" } }] },
        ],
      },
    },
  });
  assert.equal(report.valid, false);
  assert.deepEqual(report.missingRequiredChecks, [
    "CodeQL / Analyze (javascript-typescript)",
  ]);
  assert.ok(report.errors.some((error) => error.code === "required_checks_missing_live"));
});

test("live policy verifier accepts matching branch, rule and release evidence", () => {
  const policy = desiredPolicy();
  const report = evaluateLiveRepositoryPolicy({
    policy,
    live: {
      repository: { default_branch: "main" },
      branch: { name: "main", protected: true },
      activeRules: [
        { type: "pull_request" },
        { type: "required_conversation_resolution" },
        {
          type: "required_status_checks",
          parameters: {
            required_status_checks: policy.requiredChecks.map((context) => ({ context })),
          },
        },
      ],
      releaseEnvironment: {
        name: "release",
        protection_rules: [
          { type: "required_reviewers", reviewers: [{ reviewer: { login: "maintainer" } }] },
        ],
      },
    },
  });
  assert.equal(report.valid, true, JSON.stringify(report.errors, null, 2));
  assert.deepEqual(report.missingRequiredChecks, []);
});
