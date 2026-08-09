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
  if (policy?.requiredChecksStrict !== true) add("strict_required_checks_required", "Required checks must use strict branch synchronization.");
  if (!Number.isInteger(policy?.requiredCheckIntegrationId) || policy.requiredCheckIntegrationId <= 0) add("required_check_integration_invalid", "Required checks must declare the expected GitHub App integration ID.");
  if (!Array.isArray(policy?.requiredChecks) || policy.requiredChecks.length < 3) add("required_checks_incomplete", "At least CI, Dependency Review, and CodeQL must be required");
  return errors;
}

function pullRequestRule(activeRules) {
  return (activeRules || []).find((rule) => rule?.type === "pull_request") || null;
}

function requiredStatusRule(activeRules) {
  return (activeRules || []).find((rule) => rule?.type === "required_status_checks") || null;
}

function requiredCheckDescriptors(activeRules) {
  const rule = requiredStatusRule(activeRules);
  const rows =
    rule?.parameters?.required_status_checks ||
    rule?.parameters?.checks ||
    rule?.parameters?.contexts ||
    [];
  return rows
    .map((check) =>
      typeof check === "string"
        ? { context: check, integrationId: null }
        : {
            context: check?.context ? String(check.context) : null,
            integrationId: Number.isInteger(check?.integration_id)
              ? check.integration_id
              : Number.isInteger(check?.app_id)
                ? check.app_id
                : null,
          },
    )
    .filter((check) => check.context);
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

function repositoryMergeMethods(repository = {}) {
  const methods = [];
  if (repository.allow_merge_commit === true) methods.push("merge");
  if (repository.allow_squash_merge === true) methods.push("squash");
  if (repository.allow_rebase_merge === true) methods.push("rebase");
  return methods;
}

function sameStringSet(a = [], b = []) {
  const left = [...new Set(a.map(String))].sort();
  const right = [...new Set(b.map(String))].sort();
  return JSON.stringify(left) === JSON.stringify(right);
}

export function evaluateLiveRepositoryPolicy({ policy, live } = {}) {
  const errors = [];
  const add = (code, detail) => errors.push({ code, detail });
  const declaredErrors = validateRepositoryPolicy(policy);
  if (declaredErrors.length) {
    add("declared_policy_invalid", "The checked-in repository policy is invalid.");
  }

  const expectedBranch = policy?.defaultBranch;
  const repository = live?.repository || {};
  const observedBranch = repository.default_branch;
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

  const prRule = pullRequestRule(activeRules);
  const prParameters = prRule?.parameters || {};
  if (policy?.pullRequests?.required === true && !prRule) {
    add("pull_request_rule_missing", "No active pull-request rule enforces the declared PR requirement.");
  }
  if (
    policy?.pullRequests?.conversationResolution === true &&
    prParameters.required_review_thread_resolution !== true
  ) {
    add(
      "conversation_resolution_rule_missing",
      "The active pull-request rule does not require review-thread resolution.",
    );
  }
  if (
    policy?.pullRequests?.dismissStaleApprovals === true &&
    prParameters.dismiss_stale_reviews_on_push !== true
  ) {
    add(
      "stale_approvals_not_enforced",
      "The active pull-request rule does not dismiss stale approvals after a push.",
    );
  }

  const observedRuleMergeMethods = Array.isArray(prParameters.allowed_merge_methods)
    ? prParameters.allowed_merge_methods
    : [];
  if (
    policy?.merge?.methods?.length &&
    !sameStringSet(observedRuleMergeMethods, policy.merge.methods)
  ) {
    add(
      "ruleset_merge_methods_mismatch",
      `Ruleset merge methods ${observedRuleMergeMethods.join(", ") || "missing"} do not match ${policy.merge.methods.join(", ")}.`,
    );
  }

  if (policy?.branch?.allowForcePushes === false && !activeRules.some((rule) => rule?.type === "non_fast_forward")) {
    add("force_push_rule_missing", "No active non-fast-forward rule blocks force pushes.");
  }
  if (policy?.branch?.allowDeletions === false && !activeRules.some((rule) => rule?.type === "deletion")) {
    add("deletion_rule_missing", "No active deletion rule protects the default branch.");
  }

  const statusRule = requiredStatusRule(activeRules);
  const statusParameters = statusRule?.parameters || {};
  if (
    policy?.requiredChecksStrict === true &&
    statusParameters.strict_required_status_checks_policy !== true
  ) {
    add("strict_required_checks_not_enforced", "Required status checks are not configured as strict.");
  }

  const descriptors = requiredCheckDescriptors(activeRules);
  const observedChecks = new Set(descriptors.map((row) => row.context));
  const missingRequiredChecks = (policy?.requiredChecks || [])
    .filter((context) => !observedChecks.has(context))
    .sort();
  if (missingRequiredChecks.length) {
    add(
      "required_checks_missing_live",
      `Live GitHub rules are missing required checks: ${missingRequiredChecks.join(", ")}`,
    );
  }
  const expectedIntegrationId = policy?.requiredCheckIntegrationId;
  const wrongProducerChecks = descriptors
    .filter(
      (descriptor) =>
        (policy?.requiredChecks || []).includes(descriptor.context) &&
        descriptor.integrationId !== expectedIntegrationId,
    )
    .map((descriptor) => descriptor.context)
    .sort();
  if (wrongProducerChecks.length) {
    add(
      "required_check_producer_mismatch",
      `Required checks are not bound to integration ${expectedIntegrationId}: ${wrongProducerChecks.join(", ")}`,
    );
  }

  const observedRepoMergeMethods = repositoryMergeMethods(repository);
  if (policy?.merge?.methods?.length && !sameStringSet(observedRepoMergeMethods, policy.merge.methods)) {
    add(
      "repository_merge_methods_mismatch",
      `Repository merge methods ${observedRepoMergeMethods.join(", ") || "missing"} do not match ${policy.merge.methods.join(", ")}.`,
    );
  }
  if (policy?.merge?.updateBranch === true && repository.allow_update_branch !== true) {
    add("update_branch_not_enabled", "Repository update-branch support is not enabled.");
  }
  if (policy?.merge?.autoMerge === true && repository.allow_auto_merge !== true) {
    add("auto_merge_not_enabled", "Repository auto-merge is not enabled.");
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
    observedPullRequestPolicy: prRule
      ? {
          dismissStaleApprovals: prParameters.dismiss_stale_reviews_on_push === true,
          conversationResolution: prParameters.required_review_thread_resolution === true,
          allowedMergeMethods: observedRuleMergeMethods,
        }
      : null,
    strictRequiredChecks:
      statusParameters.strict_required_status_checks_policy === true,
    observedRequiredChecks: [...observedChecks].sort(),
    observedRequiredCheckDescriptors: descriptors,
    missingRequiredChecks,
    wrongProducerChecks,
    repositoryMergeMethods: observedRepoMergeMethods,
    releaseEnvironment: observedEnvironment || null,
    observedRequiredReviewers: observedReviewers,
    errors,
  };
}
