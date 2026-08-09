import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import { workflowSecurityFacts } from "./workflow-yaml-security.mjs";

const PINNED_ACTION = /^[^\s@]+@[0-9a-f]{40}$/;
const WRITE_ALLOWLIST = new Map([
  [".github/workflows/release.yml", new Set(["contents", "id-token", "attestations"])],
  [".github/workflows/codeql.yml", new Set(["security-events"])],
  [".github/workflows/scorecard.yml", new Set(["security-events", "id-token"])],
  [".github/workflows/live-integration.yml", new Set(["contents", "pull-requests", "issues"])],
]);

function posix(path) {
  return path.split(sep).join("/");
}

function workflowFiles(root) {
  const directory = join(root, ".github", "workflows");
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => /\.ya?ml$/i.test(name))
    .sort()
    .map((name) => join(directory, name));
}

function error(code, path, line, detail) {
  return { code, path, line, detail };
}

export function validateWorkflowFile(path, source) {
  path = posix(path);
  const errors = [];
  const facts = workflowSecurityFacts(source);

  for (const parseError of facts.parseErrors) {
    errors.push(
      error(
        "workflow_yaml_unsupported",
        path,
        parseError.line,
        `Security validation cannot safely interpret this YAML construct: ${parseError.code}.`,
      ),
    );
  }
  for (const line of facts.pullRequestTargetLines) {
    errors.push(
      error(
        "pull_request_target_forbidden",
        path,
        line,
        "Use pull_request with read-only permissions.",
      ),
    );
  }
  if (!facts.topLevelPermissions.length) {
    errors.push(
      error(
        "permissions_missing",
        path,
        1,
        "Declare top-level permissions explicitly.",
      ),
    );
  }

  const allowedWrites = WRITE_ALLOWLIST.get(path) || new Set();
  for (const write of facts.permissionWrites) {
    if (write.writeAll) {
      errors.push(
        error("write_all_forbidden", path, write.line, "write-all is forbidden."),
      );
      continue;
    }
    if (!allowedWrites.has(write.permission)) {
      errors.push(
        error(
          "write_permission_not_allowed",
          path,
          write.line,
          `${write.permission}: write is not approved for this workflow.`,
        ),
      );
    }
  }

  for (const use of facts.uses) {
    if (!PINNED_ACTION.test(use.value)) {
      errors.push(
        error(
          "action_not_pinned",
          path,
          use.line,
          `Pin ${use.value} to a 40-character commit SHA.`,
        ),
      );
    }
    if (
      /^actions\/checkout@[0-9a-f]{40}$/i.test(use.value) &&
      !use.checkoutPersistCredentialsFalse
    ) {
      errors.push(
        error(
          "checkout_credentials_not_disabled",
          path,
          use.line,
          "Set checkout persist-credentials to false.",
        ),
      );
    }
  }
  return errors;
}

export function validateWorkflowTree(root = process.cwd()) {
  root = resolve(root);
  const files = workflowFiles(root);
  const errors = files.flatMap((absolute) => {
    const path = posix(relative(root, absolute));
    return validateWorkflowFile(path, readFileSync(absolute, "utf8"));
  });
  return { schemaVersion: 1, kind: "github-delivery/workflow-security-report", valid: errors.length === 0, files: files.map((file) => posix(relative(root, file))), errors };
}

export function validateRepositoryPolicy(policy) {
  const errors = [];
  const add = (code, detail) => errors.push({ code, detail });
  if (policy?.schemaVersion !== 1) add("schema_version_invalid", "schemaVersion must be 1");
  if (policy?.defaultBranch !== "main") add("default_branch_invalid", "defaultBranch must be main");
  if (policy?.pullRequests?.required !== true) add("pull_request_required", "Pull requests must be required");
  if (policy?.pullRequests?.conversationResolution !== true) add("conversation_resolution_required", "Conversation resolution must be required");
  if (policy?.pullRequests?.dismissStaleApprovals !== true) add("stale_approvals_required", "Stale approvals must be dismissed");
  if (policy?.branch?.allowForcePushes !== false) add("force_push_forbidden", "Force pushes must be disabled");
  if (policy?.branch?.allowDeletions !== false) add("branch_deletion_forbidden", "Branch deletion must be disabled");
  if (JSON.stringify(policy?.merge?.methods) !== JSON.stringify(["merge"])) add("merge_method_invalid", "Only merge commits are approved");
  if (policy?.merge?.updateBranch !== true) add("update_branch_required", "Update branch support must be enabled");
  if (policy?.merge?.autoMerge !== true) add("auto_merge_required", "Auto-merge must be enabled");
  if (policy?.release?.environment !== "release") add("release_environment_required", "Release environment must be named release");
  if (policy?.release?.protectedTagPattern !== "v*") add("release_tag_pattern_invalid", "Release tags must use v*");
  if (!Number.isInteger(policy?.release?.requiredReviewers) || policy.release.requiredReviewers < 1) add("release_reviewer_required", "Release environment needs at least one reviewer");
  if (!Array.isArray(policy?.requiredChecks) || policy.requiredChecks.length < 3) add("required_checks_incomplete", "At least CI, Dependency Review, and CodeQL must be required");
  return errors;
}

function requiredCheckContexts(activeRules) {
  const contexts = new Set();
  for (const rule of activeRules || []) {
    if (rule?.type !== "required_status_checks") continue;
    const checks = rule?.parameters?.required_status_checks || rule?.parameters?.checks || [];
    for (const check of checks) {
      const context = typeof check === "string" ? check : check?.context;
      if (context) contexts.add(String(context));
    }
  }
  return contexts;
}

function requiredReviewerCount(environment) {
  let count = 0;
  for (const rule of environment?.protection_rules || []) {
    if (rule?.type !== "required_reviewers") continue;
    const reviewers = rule?.reviewers || rule?.parameters?.reviewers || [];
    if (Array.isArray(reviewers)) count += reviewers.length;
  }
  return count;
}

export function evaluateLiveRepositoryPolicy({ policy, live } = {}) {
  const errors = [];
  const add = (code, detail) => errors.push({ code, detail });
  const declaredErrors = validateRepositoryPolicy(policy);
  if (declaredErrors.length) {
    add("declared_policy_invalid", "The checked-in repository policy is invalid.");
  }

  const expectedBranch = policy?.defaultBranch;
  const observedBranch = live?.repository?.default_branch;
  if (!observedBranch || observedBranch !== expectedBranch) {
    add(
      "default_branch_mismatch",
      `Expected default branch ${expectedBranch || "missing"}, observed ${observedBranch || "missing"}.`,
    );
  }
  if (live?.branch?.protected !== true) {
    add("default_branch_unprotected", `Default branch ${expectedBranch || "missing"} is not protected.`);
  }

  const activeRules = Array.isArray(live?.activeRules) ? live.activeRules : [];
  if (!activeRules.length) {
    add("active_rules_missing", `No active GitHub rules apply to ${expectedBranch || "the default branch"}.`);
  }
  if (policy?.pullRequests?.required === true && !activeRules.some((rule) => rule?.type === "pull_request")) {
    add("pull_request_rule_missing", "No active pull-request rule enforces the declared PR requirement.");
  }
  if (
    policy?.pullRequests?.conversationResolution === true &&
    !activeRules.some((rule) =>
      ["required_conversation_resolution", "required_review_thread_resolution"].includes(rule?.type),
    )
  ) {
    add(
      "conversation_resolution_rule_missing",
      "No active conversation/review-thread resolution rule enforces the declared policy.",
    );
  }

  const observedChecks = requiredCheckContexts(activeRules);
  const missingRequiredChecks = (policy?.requiredChecks || [])
    .filter((context) => !observedChecks.has(context))
    .sort();
  if (missingRequiredChecks.length) {
    add(
      "required_checks_missing_live",
      `Live GitHub rules are missing required checks: ${missingRequiredChecks.join(", ")}`,
    );
  }

  const expectedEnvironment = policy?.release?.environment;
  const observedEnvironment = live?.releaseEnvironment?.name;
  if (!observedEnvironment || observedEnvironment !== expectedEnvironment) {
    add(
      "release_environment_missing",
      `Expected release environment ${expectedEnvironment || "missing"}, observed ${observedEnvironment || "missing"}.`,
    );
  }
  const expectedReviewers = policy?.release?.requiredReviewers || 0;
  const observedReviewers = requiredReviewerCount(live?.releaseEnvironment);
  if (observedReviewers < expectedReviewers) {
    add(
      "release_reviewer_missing",
      `Release environment requires ${expectedReviewers} reviewer(s), but GitHub exposes ${observedReviewers}.`,
    );
  }

  return {
    schemaVersion: 1,
    kind: "github-delivery/live-repository-policy-report",
    valid: errors.length === 0,
    defaultBranch: observedBranch || null,
    protected: live?.branch?.protected === true,
    activeRuleTypes: activeRules.map((rule) => rule?.type).filter(Boolean),
    observedRequiredChecks: [...observedChecks].sort(),
    missingRequiredChecks,
    releaseEnvironment: observedEnvironment || null,
    observedRequiredReviewers: observedReviewers,
    errors,
  };
}
