import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import { workflowSecurityFacts } from "./workflow-yaml-security.mjs";

const PINNED_ACTION = /^[^\s@]+@[0-9a-f]{40}$/;
const WRITE_ALLOWLIST = new Map([
  [".github/workflows/release.yml", new Set(["contents", "id-token", "attestations"])],
  [".github/workflows/create-release-tag.yml", new Set(["contents", "actions"])],
  [".github/workflows/codeql.yml", new Set(["security-events"])],
  [".github/workflows/scorecard.yml", new Set(["security-events", "id-token"])],
  [".github/workflows/live-integration.yml", new Set(["contents", "pull-requests", "issues"])],
  [".github/workflows/cleanup-orphaned-workflows.yml", new Set(["actions"])],
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
    if (write.topLevel) {
      errors.push(
        error(
          "top_level_write_forbidden",
          path,
          write.line,
          write.writeAll
            ? "Top-level write-all is forbidden; keep top-level permissions read-only and declare writes at the job level."
            : `Top-level ${write.permission}: write is forbidden; keep top-level permissions read-only and declare writes at the job level.`,
        ),
      );
      continue;
    }
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
  if (policy?.rulesets?.allowBypassActors !== false) add("ruleset_bypass_policy_required", "Ruleset bypass actors must be forbidden by checked-in policy.");
  if (policy?.release?.environment !== "release") add("release_environment_required", "Release environment must be named release");
  if (policy?.release?.protectedTagPattern !== "v*") add("release_tag_pattern_invalid", "Release tags must use v*");
  if (!Number.isInteger(policy?.release?.requiredReviewers) || policy.release.requiredReviewers < 1) add("release_reviewer_required", "Release environment needs at least one reviewer");
  if (policy?.requiredChecksStrict !== true) add("strict_required_checks_required", "Required checks must use strict branch synchronization.");
  if (!Number.isInteger(policy?.requiredCheckIntegrationId) || policy.requiredCheckIntegrationId <= 0) add("required_check_integration_invalid", "Required checks must declare the expected GitHub App integration ID.");
  if (!Array.isArray(policy?.requiredChecks) || policy.requiredChecks.length < 3) add("required_checks_incomplete", "At least CI, Dependency Review, and CodeQL must be required");
  return errors;
}

function rulesOfType(activeRules, type) {
  return (activeRules || []).filter((rule) => rule?.type === type);
}

function intersectStringLists(lists) {
  if (!lists.length) return [];
  const [first, ...rest] = lists.map((rows) => [...new Set(rows.map(String))]);
  return first.filter((value) => rest.every((rows) => rows.includes(value))).sort();
}

function effectivePullRequestPolicy(activeRules) {
  const rules = rulesOfType(activeRules, "pull_request");
  if (!rules.length) return null;
  const parameters = rules.map((rule) => rule?.parameters || {});
  const mergeMethodLists = parameters
    .map((row) => row.allowed_merge_methods)
    .filter(Array.isArray);
  return {
    dismissStaleApprovals: parameters.some(
      (row) => row.dismiss_stale_reviews_on_push === true,
    ),
    conversationResolution: parameters.some(
      (row) => row.required_review_thread_resolution === true,
    ),
    allowedMergeMethods: intersectStringLists(mergeMethodLists),
  };
}

function checkRows(rule) {
  return (
    rule?.parameters?.required_status_checks ||
    rule?.parameters?.checks ||
    rule?.parameters?.contexts ||
    []
  );
}

function normalizeCheckDescriptor(check) {
  return typeof check === "string"
    ? { context: check, integrationId: null }
    : {
        context: check?.context ? String(check.context) : null,
        integrationId: Number.isInteger(check?.integration_id)
          ? check.integration_id
          : Number.isInteger(check?.app_id)
            ? check.app_id
            : null,
      };
}

function effectiveRequiredStatusPolicy(activeRules) {
  const rules = rulesOfType(activeRules, "required_status_checks");
  const descriptors = [];
  const seen = new Set();
  for (const rule of rules) {
    for (const row of checkRows(rule)) {
      const descriptor = normalizeCheckDescriptor(row);
      if (!descriptor.context) continue;
      const key = `${descriptor.context}\u0000${descriptor.integrationId ?? "none"}`;
      if (seen.has(key)) continue;
      seen.add(key);
      descriptors.push(descriptor);
    }
  }
  descriptors.sort(
    (left, right) =>
      left.context.localeCompare(right.context) ||
      String(left.integrationId ?? "").localeCompare(String(right.integrationId ?? "")),
  );
  return {
    present: rules.length > 0,
    strict: rules.some(
      (rule) => rule?.parameters?.strict_required_status_checks_policy === true,
    ),
    descriptors,
  };
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
  const fields = ["allow_merge_commit", "allow_squash_merge", "allow_rebase_merge"];
  const complete = fields.every((field) => typeof repository[field] === "boolean");
  const methods = [];
  if (repository.allow_merge_commit === true) methods.push("merge");
  if (repository.allow_squash_merge === true) methods.push("squash");
  if (repository.allow_rebase_merge === true) methods.push("rebase");
  return { complete, methods };
}

function repositoryBooleanSetting(repository, field) {
  return typeof repository?.[field] === "boolean" ? repository[field] : null;
}

function sameStringSet(a = [], b = []) {
  const left = [...new Set(a.map(String))].sort();
  const right = [...new Set(b.map(String))].sort();
  return JSON.stringify(left) === JSON.stringify(right);
}

const RULESET_BYPASS_MODES = new Set(["never", "always", "pull_requests_only"]);

function normalizeBypassActor(actor = {}) {
  return {
    actorId: actor.actor_id ?? actor.actorId ?? null,
    actorType: actor.actor_type ?? actor.actorType ?? null,
    bypassMode: actor.bypass_mode ?? actor.bypassMode ?? null,
  };
}

export function rulesetBypassFieldsComplete(rulesets) {
  if (!Array.isArray(rulesets) || rulesets.length === 0) return false;
  return rulesets.every((ruleset) => {
    if (!Array.isArray(ruleset?.bypass_actors)) return false;
    const value = ruleset?.current_user_can_bypass;
    if (typeof value !== "string") return false;
    return RULESET_BYPASS_MODES.has(value.toLowerCase());
  });
}

export function bypassReaderCanAttest(live = {}) {
  const login = String(live.viewer?.login || "").toLowerCase();
  if (login === "github-actions[bot]") return false;
  return live.repository?.permissions?.admin === true;
}

export function liveRepositoryPolicyCiExitCode(report, { eventName } = {}) {
  if (report?.valid === true) return 0;
  const errors = Array.isArray(report?.errors) ? report.errors : [];
  if (
    eventName === "pull_request" &&
    errors.length > 0 &&
    errors.every((error) => error?.code === "ruleset_bypass_evidence_incomplete")
  ) {
    return 0;
  }
  return 1;
}

function activeRulesetBypassState(live = {}) {
  const rulesets = Array.isArray(live.activeRulesets) ? live.activeRulesets : [];
  const bypassActors = rulesets.flatMap((ruleset) =>
    (Array.isArray(ruleset?.bypass_actors) ? ruleset.bypass_actors : []).map(
      normalizeBypassActor,
    ),
  );
  const currentUserBypass = rulesets
    .map((ruleset) => ruleset?.current_user_can_bypass)
    .filter((value) => value !== undefined && value !== null)
    .map(String);
  return {
    complete:
      live.activeRulesetsComplete === true &&
      rulesetBypassFieldsComplete(rulesets) &&
      bypassReaderCanAttest(live),
    bypassActors,
    currentUserBypass,
  };
}

const REQUIRED_TAG_RULE_TYPES = ["deletion", "non_fast_forward", "update"];

function tagIncludePatterns(ruleset) {
  const include = ruleset?.conditions?.ref_name?.include;
  if (!Array.isArray(include)) return [];
  return include.map((value) => {
    const text = String(value);
    return text.startsWith("refs/tags/") ? text.slice("refs/tags/".length) : text;
  });
}

function activeTagRulesetCoversPattern(ruleset, pattern) {
  if (String(ruleset?.target) !== "tag") return false;
  if (String(ruleset?.enforcement || "").toLowerCase() !== "active") return false;
  const includes = tagIncludePatterns(ruleset);
  return includes.includes(String(pattern)) || includes.includes("~ALL");
}

function tagRulesetHasRequiredProtection(ruleset) {
  const types = new Set(
    (Array.isArray(ruleset?.rules) ? ruleset.rules : [])
      .map((rule) => rule?.type)
      .filter(Boolean),
  );
  return REQUIRED_TAG_RULE_TYPES.every((type) => types.has(type));
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

  const prPolicy = effectivePullRequestPolicy(activeRules);
  if (policy?.pullRequests?.required === true && !prPolicy) {
    add("pull_request_rule_missing", "No active pull-request rule enforces the declared PR requirement.");
  }
  if (
    policy?.pullRequests?.conversationResolution === true &&
    prPolicy?.conversationResolution !== true
  ) {
    add(
      "conversation_resolution_rule_missing",
      "The effective pull-request rules do not require review-thread resolution.",
    );
  }
  if (
    policy?.pullRequests?.dismissStaleApprovals === true &&
    prPolicy?.dismissStaleApprovals !== true
  ) {
    add(
      "stale_approvals_not_enforced",
      "The effective pull-request rules do not dismiss stale approvals after a push.",
    );
  }

  const observedRuleMergeMethods = prPolicy?.allowedMergeMethods || [];
  if (
    policy?.merge?.methods?.length &&
    !sameStringSet(observedRuleMergeMethods, policy.merge.methods)
  ) {
    add(
      "ruleset_merge_methods_mismatch",
      `Effective ruleset merge methods ${observedRuleMergeMethods.join(", ") || "missing"} do not match ${policy.merge.methods.join(", ")}.`,
    );
  }

  if (policy?.branch?.allowForcePushes === false && !activeRules.some((rule) => rule?.type === "non_fast_forward")) {
    add("force_push_rule_missing", "No active non-fast-forward rule blocks force pushes.");
  }
  if (policy?.branch?.allowDeletions === false && !activeRules.some((rule) => rule?.type === "deletion")) {
    add("deletion_rule_missing", "No active deletion rule protects the default branch.");
  }

  const statusPolicy = effectiveRequiredStatusPolicy(activeRules);
  if (
    policy?.requiredChecksStrict === true &&
    statusPolicy.strict !== true
  ) {
    add("strict_required_checks_not_enforced", "Effective required status checks are not configured as strict.");
  }

  const descriptors = statusPolicy.descriptors;
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
  const wrongProducerChecks = [...new Set(
    descriptors
      .filter(
        (descriptor) =>
          (policy?.requiredChecks || []).includes(descriptor.context) &&
          descriptor.integrationId !== expectedIntegrationId,
      )
      .map((descriptor) => descriptor.context),
  )].sort();
  if (wrongProducerChecks.length) {
    add(
      "required_check_producer_mismatch",
      `Required checks are not bound exclusively to integration ${expectedIntegrationId}: ${wrongProducerChecks.join(", ")}`,
    );
  }

  const bypassState = activeRulesetBypassState(live || {});
  if (policy?.rulesets?.allowBypassActors === false) {
    if (!bypassState.complete) {
      add(
        "ruleset_bypass_evidence_incomplete",
        "Active ruleset bypass configuration could not be read completely.",
      );
    }
    if (bypassState.bypassActors.length) {
      add(
        "ruleset_bypass_actor_present",
        `Active rulesets expose ${bypassState.bypassActors.length} bypass actor(s), but checked-in policy forbids bypass actors.`,
      );
    }
    const bypassModes = bypassState.currentUserBypass.filter(
      (value) => value.toLowerCase() !== "never",
    );
    if (bypassModes.length) {
      add(
        "current_user_can_bypass_ruleset",
        `The current GitHub actor can bypass an active ruleset: ${[...new Set(bypassModes)].join(", ")}.`,
      );
    }
  }

  const observedRepoMerge = repositoryMergeMethods(repository);
  if (policy?.merge?.methods?.length) {
    if (!observedRepoMerge.complete) {
      add(
        "repository_merge_settings_unreadable",
        "GitHub did not expose all repository merge-method settings to this verifier; refusing to infer disabled state from missing fields.",
      );
    } else if (!sameStringSet(observedRepoMerge.methods, policy.merge.methods)) {
      add(
        "repository_merge_methods_mismatch",
        `Repository merge methods ${observedRepoMerge.methods.join(", ") || "none"} do not match ${policy.merge.methods.join(", ")}.`,
      );
    }
  }

  if (policy?.merge?.updateBranch === true) {
    const value = repositoryBooleanSetting(repository, "allow_update_branch");
    if (value === null) {
      add(
        "update_branch_setting_unreadable",
        "GitHub did not expose allow_update_branch to this verifier; the setting is unknown, not proven disabled.",
      );
    } else if (value !== true) {
      add("update_branch_not_enabled", "Repository update-branch support is not enabled.");
    }
  }
  if (policy?.merge?.autoMerge === true) {
    const value = repositoryBooleanSetting(repository, "allow_auto_merge");
    if (value === null) {
      add(
        "auto_merge_setting_unreadable",
        "GitHub did not expose allow_auto_merge to this verifier; the setting is unknown, not proven disabled.",
      );
    } else if (value !== true) {
      add("auto_merge_not_enabled", "Repository auto-merge is not enabled.");
    }
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

  const expectedTagPattern = policy?.release?.protectedTagPattern;
  const tagRulesets = Array.isArray(live?.tagRulesets) ? live.tagRulesets : [];
  if (expectedTagPattern) {
    if (live?.tagRulesetsComplete !== true) {
      add(
        "protected_tag_evidence_incomplete",
        "Protected tag ruleset configuration could not be read completely.",
      );
    } else {
      const covering = tagRulesets.filter((ruleset) =>
        activeTagRulesetCoversPattern(ruleset, expectedTagPattern),
      );
      if (!covering.length) {
        add(
          "protected_tag_pattern_missing",
          `No active tag ruleset covers protected pattern ${expectedTagPattern}.`,
        );
      } else if (!covering.some((ruleset) => tagRulesetHasRequiredProtection(ruleset))) {
        add(
          "protected_tag_rules_missing",
          `Tag ruleset for ${expectedTagPattern} does not enforce deletion, non-fast-forward, and update protection.`,
        );
      }
    }
  }

  return {
    schemaVersion: 1,
    kind: "github-delivery/live-repository-policy-report",
    valid: errors.length === 0,
    defaultBranch: observedBranch || null,
    protected: live?.branch?.protected === true,
    activeRuleTypes: activeRules.map((rule) => rule?.type).filter(Boolean),
    observedPullRequestPolicy: prPolicy,
    strictRequiredChecks: statusPolicy.strict === true,
    observedRequiredChecks: [...observedChecks].sort(),
    observedRequiredCheckDescriptors: descriptors,
    missingRequiredChecks,
    wrongProducerChecks,
    activeRulesetsComplete: bypassState.complete,
    observedRulesetBypassActors: bypassState.bypassActors,
    currentUserRulesetBypass: bypassState.currentUserBypass,
    repositoryMergeMethods: observedRepoMerge.methods,
    repositoryMergeSettingsComplete: observedRepoMerge.complete,
    releaseEnvironment: observedEnvironment || null,
    observedRequiredReviewers: observedReviewers,
    observedProtectedTagPattern: expectedTagPattern || null,
    errors,
  };
}
