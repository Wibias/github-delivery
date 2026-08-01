import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const PINNED_ACTION = /^[^\s@]+@[0-9a-f]{40}$/;
const WRITE_ALLOWLIST = new Map([
  [".github/workflows/release.yml", new Set(["contents", "id-token", "attestations"])],
  [".github/workflows/codeql.yml", new Set(["security-events"])],
  [".github/workflows/scorecard.yml", new Set(["security-events", "id-token"])],
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

function lineNumber(source, index) {
  return source.slice(0, index).split("\n").length;
}

function error(code, path, line, detail) {
  return { code, path, line, detail };
}

export function validateWorkflowFile(path, source) {
  path = posix(path);
  source = source.replace(/\r\n?/g, "\n");
  const errors = [];
  if (/^\s*pull_request_target\s*:/m.test(source)) {
    errors.push(error("pull_request_target_forbidden", path, lineNumber(source, source.search(/^\s*pull_request_target\s*:/m)), "Use pull_request with read-only permissions."));
  }
  if (!/^permissions:\s*(?:\n|$)/m.test(source) && !/^permissions:\s*read-all\s*$/m.test(source)) {
    errors.push(error("permissions_missing", path, 1, "Declare top-level permissions explicitly."));
  }
  if (/^\s*permissions:\s*write-all\s*$/m.test(source)) {
    errors.push(error("write_all_forbidden", path, lineNumber(source, source.search(/^\s*permissions:\s*write-all\s*$/m)), "write-all is forbidden."));
  }
  for (const match of source.matchAll(/uses:\s+([^\s#]+)/g)) {
    if (!PINNED_ACTION.test(match[1])) {
      errors.push(error("action_not_pinned", path, lineNumber(source, match.index), `Pin ${match[1]} to a 40-character commit SHA.`));
    }
  }
  for (const match of source.matchAll(/uses:\s+actions\/checkout@[0-9a-f]{40}[^\n]*\n((?:\s+[^\n]*\n){0,8})/g)) {
    if (!/persist-credentials:\s*false/.test(match[1])) {
      errors.push(error("checkout_credentials_not_disabled", path, lineNumber(source, match.index), "Set checkout persist-credentials to false."));
    }
  }
  const allowedWrites = WRITE_ALLOWLIST.get(path) || new Set();
  for (const match of source.matchAll(/^\s{0,8}([a-z-]+):\s*write\s*$/gm)) {
    const permission = match[1];
    if (!allowedWrites.has(permission)) {
      errors.push(error("write_permission_not_allowed", path, lineNumber(source, match.index), `${permission}: write is not approved for this workflow.`));
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
  return { schemaVersion: 1, kind: "shipping-github/workflow-security-report", valid: errors.length === 0, files: files.map((file) => posix(relative(root, file))), errors };
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
