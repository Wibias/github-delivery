import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const APPROVED_MUTATION_FILES = new Set([
  "scripts/lib/github-mutation-broker.mjs",
  "scripts/lib/autonomous-idempotency-claim.mjs",
  "scripts/lib/lifecycle-mutations.mjs",
  "scripts/lib/mutation-boundary-security.mjs",
  "scripts/live-github-fixture.mjs",
  "scripts/cleanup-live-github-fixture.mjs",
  "scripts/lib/live-github-fixture.mjs",
  "scripts/lib/live-fixture-cleanup.mjs",
]);

const APPROVAL_MUTATION_FILE = "scripts/lib/github-approval-mutation-broker.mjs";

const DETECTOR_FILES = new Set(["scripts/lib/mutation-boundary-security.mjs"]);

const FIXTURE_FILES = new Set([
  "scripts/live-github-fixture.mjs",
  "scripts/cleanup-live-github-fixture.mjs",
  "scripts/lib/live-github-fixture.mjs",
  "scripts/lib/live-fixture-cleanup.mjs",
]);

const BOUNDARY_GH_GROUPS = new Set(["pr", "issue"]);

const WRITE_GROUP_VERBS = {
  pr: new Set(["create", "close", "comment", "edit", "merge", "ready", "reopen", "review"]),
  issue: new Set(["create", "close", "comment", "edit", "reopen"]),
  release: new Set(["create", "delete", "edit", "upload"]),
  workflow: new Set(["disable", "enable", "run"]),
  run: new Set(["cancel", "delete", "rerun"]),
  label: new Set(["clone", "create", "delete", "edit"]),
  secret: new Set(["delete", "set"]),
  variable: new Set(["delete", "set"]),
};

const GH_COMMAND_RE = /["']gh["']\s*,\s*(?:\[\s*)?["']([a-z-]+)["']\s*,\s*["']([a-z-]+)["']/g;
const GH_DYNAMIC_GROUP_VERB_RE = /["']gh["']\s*,\s*(?:\[\s*)?["'](pr|issue|release|workflow|run|label|secret|variable)["']\s*,(?!\s*["'])\s*/g;
const GH_INDIRECT_ARGV_RE = /["']gh["']\s*,\s*(?:\[\s*\.\.\.\s*)?([A-Za-z_$][\w$]*)/g;
const GH_API_RE = /["']gh["']\s*,\s*(?:\[\s*)?["']api["'][\s\S]{0,1800}/g;
const STANDALONE_API_RE = /\[\s*["']api["']\s*,[\s\S]{0,1200}?(?:["']--method["']|["']-X["'])/g;
const GH_API_DYNAMIC_METHOD_RE = /["']gh["']\s*,\s*(?:\[\s*)?["']api["'][\s\S]{0,1800}?["'](?:--method|-X)["']\s*,(?!\s*["'])\s*/g;
const GH_GRAPHQL_INVOCATION_RE = /["']gh["']\s*,\s*(?:\[\s*)?["']api["']\s*,\s*["']graphql["']/i;
const MUTATING_METHOD_RE = /(?:["']--method["']\s*,\s*["'](?:POST|PATCH|PUT|DELETE)["']|["']-X["']\s*,\s*["'](?:POST|PATCH|PUT|DELETE)["']|["']--method=(?:POST|PATCH|PUT|DELETE)["'])/i;
const GRAPHQL_MUTATION_RE = /\bmutation(?:\s+[A-Za-z_]\w*)?\s*(?:\([^)]*\))?\s*\{/i;
const GRAPHQL_MUTATION_NAME_RE = /\bmutation(?:\s+[A-Za-z_]\w*)?\s*(?:\([^)]*\))?\s*\{\s*([A-Za-z_]\w*)/g;
const GIT_PUSH_RE = /["']git["']\s*,\s*(?:\[\s*)?["']push["']/g;
const FORBIDDEN_API_SEGMENT_RE = /\/(?:actions|secrets|variables|environments|rulesets|hooks|releases)(?:\/|$)/i;
const API_PATH_KEEP = new Set([
  "repos",
  "pulls",
  "issues",
  "comments",
  "replies",
  "git",
  "refs",
  "tags",
  "heads",
  "actions",
  "secrets",
  "variables",
  "environments",
  "rulesets",
  "hooks",
  "releases",
  "graphql",
]);
const REGISTERED_BROKER_API_PATHS = new Set([
  "repos/x/pulls",
  "repos/x/x/pulls",
  "repos/x/x/pulls/x",
  "repos/x/x/pulls/x/comments/x/replies",
  "repos/x/x/issues/comments/x",
  "repos/x/x/git/refs",
  "repos/x/x/git/refs/x",
  "repos/x/x/git/refs/heads/x",
  "repos/x/x/git/tags",
]);
const REGISTERED_GRAPHQL_MUTATIONS = new Set([
  "resolveReviewThread",
  "dismissPullRequestReview",
]);

function portable(path) {
  return path.split("\\").join("/");
}

function productionScripts(root) {
  const scriptsRoot = join(root, "scripts");
  const files = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".mjs")) {
        files.push(portable(relative(root, absolute)));
      }
    }
  }
  walk(scriptsRoot);
  return files.sort();
}

function error(path, code, message, extra = {}) {
  return { path, code, message, ...extra };
}

function hasError(errors, code) {
  return errors.some((item) => item.code === code);
}

function identifierBindingText(source, name) {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return "";
  const chunks = [];
  const assign = new RegExp(String.raw`(?:const|let|var)\s+${name}\s*=\s*([^;]+)`, "g");
  for (const match of source.matchAll(assign)) chunks.push(match[1]);
  const push = new RegExp(String.raw`${name}\.push\s*\(([^)]*)\)`, "g");
  for (const match of source.matchAll(push)) chunks.push(match[1]);
  return chunks.join("\n");
}

function bindingWrite(text) {
  if (!text) return null;
  for (const [group, verbs] of Object.entries(WRITE_GROUP_VERBS)) {
    for (const verb of verbs) {
      if (new RegExp(String.raw`["']${group}["'][\s\S]{0,80}["']${verb}["']`).test(text)) {
        return { group, verb };
      }
    }
  }
  if (MUTATING_METHOD_RE.test(text)) return { group: "api", verb: "method" };
  return null;
}

function extractApiPath(window) {
  const template = window.match(/`((?:repos\/)[^`]*)`/i);
  if (template) return template[1];
  const quoted = window.match(/["']((?:repos\/)[^"']+)["']/i);
  if (quoted) return quoted[1];
  return null;
}

function generalizeApiPath(path) {
  return String(path)
    .replace(/\$\{[^}]+\}/g, "x")
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .map((segment) => (API_PATH_KEEP.has(segment) ? segment : "x"))
    .join("/");
}

function isRegisteredBrokerApiPath(path) {
  if (!path || FORBIDDEN_API_SEGMENT_RE.test(path)) return false;
  const general = generalizeApiPath(path);
  if (REGISTERED_BROKER_API_PATHS.has(general)) return true;
  return general.startsWith("repos/x/x/git/refs/");
}

function graphqlMutationNames(text) {
  const names = [];
  GRAPHQL_MUTATION_NAME_RE.lastIndex = 0;
  for (const match of text.matchAll(GRAPHQL_MUTATION_NAME_RE)) names.push(match[1]);
  return names;
}

function pushMutatingApiWindow(path, window, errors) {
  if (!MUTATING_METHOD_RE.test(window)) return;
  const apiPath = extractApiPath(window);
  if (APPROVED_MUTATION_FILES.has(path) && !isRegisteredBrokerApiPath(apiPath)) {
    errors.push(
      error(
        path,
        "unregistered_gh_api_mutation",
        "Mutating gh api calls in privileged files must match a registered broker endpoint shape.",
        { apiPath },
      ),
    );
    return;
  }
  errors.push(
    error(
      path,
      "direct_gh_api_mutation",
      "Mutating gh api calls must route through the mutation broker.",
      { apiPath },
    ),
  );
}

function pushGraphqlWindow(path, window, errors) {
  if (!GRAPHQL_MUTATION_RE.test(window)) return;
  const names = graphqlMutationNames(window);
  if (APPROVED_MUTATION_FILES.has(path) && names.length === 0) {
    errors.push(
      error(
        path,
        "unregistered_graphql_mutation",
        "GraphQL mutations in privileged files must expose a statically registered root mutation.",
        { names: [], reason: "mutation_root_unresolved" },
      ),
    );
    return;
  }
  const unregistered = names.filter((name) => !REGISTERED_GRAPHQL_MUTATIONS.has(name));
  if (APPROVED_MUTATION_FILES.has(path) && unregistered.length > 0) {
    errors.push(
      error(
        path,
        "unregistered_graphql_mutation",
        "GraphQL mutations in privileged files must use a registered broker mutation.",
        { names: unregistered },
      ),
    );
    return;
  }
  errors.push(
    error(
      path,
      "direct_graphql_mutation",
      "GitHub GraphQL mutations must route through the mutation broker.",
      { names },
    ),
  );
}

export function validateMutationBoundarySource(path, source) {
  path = portable(path);
  if (DETECTOR_FILES.has(path) || FIXTURE_FILES.has(path)) return [];
  const errors = [];

  GH_COMMAND_RE.lastIndex = 0;
  for (const match of source.matchAll(GH_COMMAND_RE)) {
    const group = match[1];
    const verb = match[2];
    if (WRITE_GROUP_VERBS[group]?.has(verb)) {
      errors.push(
        error(
          path,
          "direct_gh_mutation",
          `Direct gh ${group} ${verb} mutation must route through the mutation broker.`,
          { group, verb },
        ),
      );
    }
  }

  GH_DYNAMIC_GROUP_VERB_RE.lastIndex = 0;
  for (const match of source.matchAll(GH_DYNAMIC_GROUP_VERB_RE)) {
    errors.push(
      error(
        path,
        "dynamic_gh_verb",
        `Dynamic gh ${match[1]} verbs are forbidden outside the mutation boundary because their write/read effect cannot be proven statically.`,
      ),
    );
  }

  GH_INDIRECT_ARGV_RE.lastIndex = 0;
  for (const match of source.matchAll(GH_INDIRECT_ARGV_RE)) {
    const ident = match[1];
    const write = bindingWrite(identifierBindingText(source, ident));
    if (!write) continue;
    errors.push(
      error(
        path,
        write.group === "api" ? "direct_gh_api_mutation" : "direct_gh_mutation",
        `Direct gh ${write.group} ${write.verb} mutation must route through the mutation broker.`,
        { group: write.group, verb: write.verb, ident },
      ),
    );
  }

  GH_API_RE.lastIndex = 0;
  for (const match of source.matchAll(GH_API_RE)) {
    const window = match[0];
    pushMutatingApiWindow(path, window, errors);
    if (/\bgraphql\b/i.test(window)) pushGraphqlWindow(path, window, errors);
  }

  STANDALONE_API_RE.lastIndex = 0;
  for (const match of source.matchAll(STANDALONE_API_RE)) {
    pushMutatingApiWindow(path, match[0], errors);
  }

  GH_API_DYNAMIC_METHOD_RE.lastIndex = 0;
  if (GH_API_DYNAMIC_METHOD_RE.test(source)) {
    errors.push(
      error(
        path,
        "dynamic_gh_api_method",
        "Dynamic gh api HTTP methods are forbidden outside the mutation boundary.",
      ),
    );
  }

  if (
    !hasError(errors, "direct_graphql_mutation") &&
    !hasError(errors, "unregistered_graphql_mutation") &&
    GH_GRAPHQL_INVOCATION_RE.test(source) &&
    GRAPHQL_MUTATION_RE.test(source)
  ) {
    pushGraphqlWindow(path, source, errors);
  }

  GIT_PUSH_RE.lastIndex = 0;
  if (GIT_PUSH_RE.test(source)) {
    errors.push(
      error(
        path,
        "direct_git_push",
        "Remote git push must route through the lifecycle mutation boundary.",
      ),
    );
  }

  return errors.filter((item) => !isAllowedBoundaryWrite(path, item));
}

function isAllowedBoundaryWrite(path, item) {
  if (path === APPROVAL_MUTATION_FILE) {
    return item.code === "direct_gh_mutation" && item.group === "pr" && item.verb === "review";
  }
  if (!APPROVED_MUTATION_FILES.has(path)) return false;
  if (item.code === "direct_gh_mutation") return BOUNDARY_GH_GROUPS.has(item.group);
  if (item.code === "direct_git_push") return path === "scripts/lib/lifecycle-mutations.mjs";
  return item.code === "direct_gh_api_mutation" || item.code === "direct_graphql_mutation";
}

export function validateMutationBoundaryTree(root = process.cwd()) {
  root = resolve(root);
  const files = productionScripts(root);
  const errors = [];
  for (const path of files) {
    const source = readFileSync(join(root, path), "utf8");
    errors.push(...validateMutationBoundarySource(path, source));
  }
  return {
    valid: errors.length === 0,
    files,
    approvedMutationFiles: [...APPROVED_MUTATION_FILES, APPROVAL_MUTATION_FILE].sort(),
    errors,
  };
}
