import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  evaluateLiveRepositoryPolicy,
  liveRepositoryPolicyCiExitCode,
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
    rulesets: { allowBypassActors: false },
    release: {
      environment: "release",
      protectedTagPattern: "v*",
      requiredReviewers: 1,
    },
    requiredChecksStrict: true,
    requiredCheckIntegrationId: 15368,
    requiredChecks: [
      "Node 22 / ubuntu-latest",
      "Dependency Review",
      "CodeQL / Analyze (javascript-typescript)",
    ],
  };
}

function matchingLive(policy = desiredPolicy()) {
  return {
    repository: {
      default_branch: "main",
      allow_merge_commit: true,
      allow_squash_merge: false,
      allow_rebase_merge: false,
      allow_update_branch: true,
      allow_auto_merge: true,
      permissions: { admin: true },
    },
    branch: { name: "main", protected: true },
    activeRules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      {
        type: "pull_request",
        parameters: {
          required_approving_review_count: 0,
          dismiss_stale_reviews_on_push: true,
          required_review_thread_resolution: true,
          allowed_merge_methods: ["merge"],
        },
      },
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: true,
          required_status_checks: policy.requiredChecks.map((context) => ({
            context,
            integration_id: policy.requiredCheckIntegrationId,
          })),
        },
      },
    ],
    activeRulesetsComplete: true,
    activeRulesets: [
      {
        id: 1,
        bypass_actors: [],
        current_user_can_bypass: "never",
      },
    ],
    releaseEnvironment: {
      name: "release",
      protection_rules: [
        { type: "required_reviewers", reviewers: [{ reviewer: { login: "maintainer" } }] },
      ],
    },
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
  assert(errors.some((error) => error.code === "top_level_write_forbidden" || error.code === "write_permission_not_allowed"));
  assert(errors.some((error) => error.code === "action_not_pinned"));
});

test("inline trigger and permissions mappings are inspected semantically", () => {
  const source = `name: Bad\non: [push, 'pull_request_target']\npermissions: { contents: write }\njobs:\n  test:\n    runs-on: ubuntu-latest\n`;
  const errors = validateWorkflowFile(".github/workflows/bad.yml", source);
  assert(errors.some((error) => error.code === "pull_request_target_forbidden"));
  assert(errors.some((error) => error.code === "top_level_write_forbidden" || error.code === "write_permission_not_allowed"));
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
  const source = `name: Bad\non:\n  push:\npermissions:\n  contents: read\njobs:\n  test:\n    runs-on: ubuntu-latest\n    permissions:\n      contents: write\n    steps:\n      - uses: actions/checkout@${"a".repeat(40)}\n        with:\n          persist-credentials: false\n`;
  const errors = validateWorkflowFile(".github/workflows/bad.yml", source);
  assert(errors.some((error) => error.code === "write_permission_not_allowed"));
});

test("rejects top-level write permissions even on allowlisted workflows", () => {
  const source = `name: Clean\non:\n  push:\npermissions:\n  actions: write\n  contents: read\njobs:\n  cleanup:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@${"a".repeat(40)}\n        with:\n          persist-credentials: false\n`;
  const errors = validateWorkflowFile(".github/workflows/cleanup-orphaned-workflows.yml", source);
  assert(errors.some((error) => error.code === "top_level_write_forbidden"));
});

test("accepts job-level write permissions on allowlisted workflows", () => {
  const source = `name: Clean\non:\n  push:\npermissions:\n  contents: read\njobs:\n  cleanup:\n    runs-on: ubuntu-latest\n    permissions:\n      actions: write\n      contents: read\n    steps:\n      - uses: actions/checkout@${"a".repeat(40)}\n        with:\n          persist-credentials: false\n`;
  const errors = validateWorkflowFile(".github/workflows/cleanup-orphaned-workflows.yml", source);
  assert.equal(errors.some((error) => error.code === "top_level_write_forbidden"), false);
  assert.equal(errors.some((error) => error.code === "write_permission_not_allowed"), false);
});

test("desired repository policy is fail-closed", () => {
  const policy = desiredPolicy();
  assert.deepEqual(validateRepositoryPolicy(policy), []);
  policy.merge.methods = ["merge", "squash"];
  assert.match(validateRepositoryPolicy(policy)[0].code, /merge_method/);
});

test("checked-in policy must explicitly forbid ruleset bypass actors", () => {
  const policy = desiredPolicy();
  delete policy.rulesets;
  assert.ok(
    validateRepositoryPolicy(policy).some(
      (error) => error.code === "ruleset_bypass_policy_required",
    ),
  );
});

test("live policy drift detects an unprotected default branch and missing release reviewer", () => {
  const live = matchingLive();
  live.branch.protected = false;
  live.releaseEnvironment.protection_rules = [];
  const report = evaluateLiveRepositoryPolicy({ policy: desiredPolicy(), live });
  assert.equal(report.valid, false);
  assert.ok(report.errors.some((error) => error.code === "default_branch_unprotected"));
  assert.ok(report.errors.some((error) => error.code === "release_reviewer_missing"));
});

test("live policy verifier reads conversation and stale-review controls from pull_request parameters", () => {
  const live = matchingLive();
  const pullRule = live.activeRules.find((rule) => rule.type === "pull_request");
  pullRule.parameters.dismiss_stale_reviews_on_push = false;
  const report = evaluateLiveRepositoryPolicy({ policy: desiredPolicy(), live });
  assert.equal(report.observedPullRequestPolicy.conversationResolution, true);
  assert.equal(report.observedPullRequestPolicy.dismissStaleApprovals, false);
  assert.ok(report.errors.some((error) => error.code === "stale_approvals_not_enforced"));
  assert.equal(
    report.errors.some((error) => error.code === "conversation_resolution_rule_missing"),
    false,
  );
});

test("live policy drift reports missing required check contexts", () => {
  const live = matchingLive();
  const statusRule = live.activeRules.find((rule) => rule.type === "required_status_checks");
  statusRule.parameters.required_status_checks = statusRule.parameters.required_status_checks.slice(0, 2);
  const report = evaluateLiveRepositoryPolicy({ policy: desiredPolicy(), live });
  assert.equal(report.valid, false);
  assert.deepEqual(report.missingRequiredChecks, [
    "CodeQL / Analyze (javascript-typescript)",
  ]);
  assert.ok(report.errors.some((error) => error.code === "required_checks_missing_live"));
});

test("live policy verifier detects wrong required-check producer and non-strict policy", () => {
  const live = matchingLive();
  const statusRule = live.activeRules.find((rule) => rule.type === "required_status_checks");
  statusRule.parameters.strict_required_status_checks_policy = false;
  statusRule.parameters.required_status_checks[0].integration_id = 999;
  const report = evaluateLiveRepositoryPolicy({ policy: desiredPolicy(), live });
  assert.equal(report.valid, false);
  assert.ok(report.errors.some((error) => error.code === "strict_required_checks_not_enforced"));
  assert.ok(report.errors.some((error) => error.code === "required_check_producer_mismatch"));
});

test("live policy verifier aggregates layered rules independent of API order", () => {
  const policy = desiredPolicy();
  const live = matchingLive(policy);
  const descriptors = policy.requiredChecks.map((context) => ({
    context,
    integration_id: policy.requiredCheckIntegrationId,
  }));
  live.activeRules = [
    { type: "deletion" },
    { type: "non_fast_forward" },
    {
      type: "pull_request",
      parameters: {
        dismiss_stale_reviews_on_push: false,
        required_review_thread_resolution: false,
        allowed_merge_methods: ["merge", "squash"],
      },
    },
    {
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: false,
        required_status_checks: descriptors.slice(0, 1),
      },
    },
    {
      type: "pull_request",
      parameters: {
        dismiss_stale_reviews_on_push: true,
        required_review_thread_resolution: true,
        allowed_merge_methods: ["merge"],
      },
    },
    {
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: true,
        required_status_checks: descriptors.slice(1),
      },
    },
  ];

  const first = evaluateLiveRepositoryPolicy({ policy, live });
  const second = evaluateLiveRepositoryPolicy({
    policy,
    live: { ...live, activeRules: [...live.activeRules].reverse() },
  });

  assert.equal(first.valid, true, JSON.stringify(first.errors));
  assert.equal(second.valid, true, JSON.stringify(second.errors));
  assert.deepEqual(second.observedPullRequestPolicy, first.observedPullRequestPolicy);
  assert.deepEqual(second.observedRequiredChecks, first.observedRequiredChecks);
  assert.equal(second.strictRequiredChecks, true);
});

test("live policy verifier fails when an active ruleset exposes a bypass", () => {
  const live = matchingLive();
  live.activeRulesets[0].bypass_actors = [
    { actor_id: 42, actor_type: "Team", bypass_mode: "always" },
  ];
  live.activeRulesets[0].current_user_can_bypass = "always";
  const report = evaluateLiveRepositoryPolicy({ policy: desiredPolicy(), live });

  assert.equal(report.valid, false);
  assert.ok(report.errors.some((error) => error.code === "ruleset_bypass_actor_present"));
  assert.ok(report.errors.some((error) => error.code === "current_user_can_bypass_ruleset"));
});

test("live policy verifier fails closed when bypass evidence is incomplete", () => {
  const live = matchingLive();
  live.activeRulesetsComplete = false;
  const report = evaluateLiveRepositoryPolicy({ policy: desiredPolicy(), live });
  assert.equal(report.valid, false);
  assert.ok(
    report.errors.some(
      (error) => error.code === "ruleset_bypass_evidence_incomplete",
    ),
  );
});

test("live policy verifier fails closed when the reader cannot attest ruleset bypass", () => {
  const live = matchingLive();
  delete live.repository.permissions;
  const report = evaluateLiveRepositoryPolicy({ policy: desiredPolicy(), live });
  assert.equal(report.valid, false);
  assert.ok(
    report.errors.some((error) => error.code === "ruleset_bypass_evidence_incomplete"),
  );
});

test("live policy verifier fails closed when github-actions bot reports never plus empty bypass actors", () => {
  const live = matchingLive();
  live.repository.permissions = { admin: true };
  live.viewer = { login: "github-actions[bot]" };
  const report = evaluateLiveRepositoryPolicy({ policy: desiredPolicy(), live });
  assert.equal(report.valid, false);
  assert.ok(
    report.errors.some((error) => error.code === "ruleset_bypass_evidence_incomplete"),
  );
});

test("live policy verifier fails closed when current_user_can_bypass is missing", () => {
  const live = matchingLive();
  live.repository.permissions = { admin: true };
  delete live.activeRulesets[0].current_user_can_bypass;
  const report = evaluateLiveRepositoryPolicy({ policy: desiredPolicy(), live });
  assert.equal(report.valid, false);
  assert.ok(
    report.errors.some((error) => error.code === "ruleset_bypass_evidence_incomplete"),
  );
});

test("live policy verifier fails closed when bypass_actors is omitted", () => {
  const live = matchingLive();
  live.repository.permissions = { admin: true };
  delete live.activeRulesets[0].bypass_actors;
  const report = evaluateLiveRepositoryPolicy({ policy: desiredPolicy(), live });
  assert.equal(report.valid, false);
  assert.ok(
    report.errors.some((error) => error.code === "ruleset_bypass_evidence_incomplete"),
  );
});

test("live policy verifier fails closed when no active rulesets were fetched", () => {
  const live = matchingLive();
  live.repository.permissions = { admin: true };
  live.activeRulesets = [];
  live.activeRulesetsComplete = true;
  const report = evaluateLiveRepositoryPolicy({ policy: desiredPolicy(), live });
  assert.equal(report.valid, false);
  assert.ok(
    report.errors.some((error) => error.code === "ruleset_bypass_evidence_incomplete"),
  );
});

test("live policy verifier fails when current user bypass is pull_requests_only", () => {
  const live = matchingLive();
  live.repository.permissions = { admin: true };
  live.activeRulesets[0].current_user_can_bypass = "pull_requests_only";
  const report = evaluateLiveRepositoryPolicy({ policy: desiredPolicy(), live });
  assert.equal(report.valid, false);
  assert.ok(report.errors.some((error) => error.code === "current_user_can_bypass_ruleset"));
});

test("live policy verifier accepts empty bypass actors from an admin reader", () => {
  const live = matchingLive();
  live.repository.permissions = { admin: true };
  const report = evaluateLiveRepositoryPolicy({ policy: desiredPolicy(), live });
  assert.equal(report.valid, true, JSON.stringify(report.errors));
});

test("pull_request CI does not fail when the only live policy gap is unprivileged bypass attestation", () => {
  const live = matchingLive();
  delete live.repository.permissions;
  const report = evaluateLiveRepositoryPolicy({ policy: desiredPolicy(), live });
  assert.equal(report.valid, false);
  assert.equal(liveRepositoryPolicyCiExitCode(report, { eventName: "pull_request" }), 0);
  assert.equal(liveRepositoryPolicyCiExitCode(report, { eventName: "schedule" }), 1);
  assert.equal(liveRepositoryPolicyCiExitCode(report, { eventName: "push" }), 1);
});

test("pull_request CI still fails when bypass attestation is incomplete plus other live drift", () => {
  const live = matchingLive();
  delete live.repository.permissions;
  live.branch.protected = false;
  const report = evaluateLiveRepositoryPolicy({ policy: desiredPolicy(), live });
  assert.equal(liveRepositoryPolicyCiExitCode(report, { eventName: "pull_request" }), 1);
});

test("pull_request CI still fails when an admin reader can bypass pull requests", () => {
  const live = matchingLive();
  live.repository.permissions = { admin: true };
  live.activeRulesets[0].current_user_can_bypass = "pull_requests_only";
  const report = evaluateLiveRepositoryPolicy({ policy: desiredPolicy(), live });
  assert.equal(liveRepositoryPolicyCiExitCode(report, { eventName: "pull_request" }), 1);
});

test("live policy verifier detects branch and repository merge control drift", () => {
  const live = matchingLive();
  live.activeRules = live.activeRules.filter((rule) => !["deletion", "non_fast_forward"].includes(rule.type));
  live.repository.allow_squash_merge = true;
  live.repository.allow_update_branch = false;
  live.repository.allow_auto_merge = false;
  const report = evaluateLiveRepositoryPolicy({ policy: desiredPolicy(), live });
  assert.equal(report.valid, false);
  for (const code of [
    "force_push_rule_missing",
    "deletion_rule_missing",
    "repository_merge_methods_mismatch",
    "update_branch_not_enabled",
    "auto_merge_not_enabled",
  ]) {
    assert.ok(report.errors.some((error) => error.code === code), code);
  }
});

test("live policy verifier accepts current GitHub rule shapes when every declared control matches", () => {
  const policy = desiredPolicy();
  const report = evaluateLiveRepositoryPolicy({ policy, live: matchingLive(policy) });
  assert.equal(report.valid, true, JSON.stringify(report.errors, null, 2));
  assert.deepEqual(report.missingRequiredChecks, []);
  assert.deepEqual(report.wrongProducerChecks, []);
  assert.equal(report.strictRequiredChecks, true);
  assert.equal(report.observedPullRequestPolicy.conversationResolution, true);
  assert.deepEqual(report.observedRulesetBypassActors, []);
});
