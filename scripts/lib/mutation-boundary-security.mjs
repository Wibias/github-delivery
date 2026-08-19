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
const GH_DYNAMIC_GROUP_VERB_RE = /["']gh["']\s*,\s*(?:\[\s*)?["'](pr|issue|release|workflow|run|label|secret|variable)["']\s*,\s*(?!["'])/g;
const GH_API_RE = /["']gh["']\s*,\s*(?:\[\s*)?["']api["'][\s\S]{0,1800}/g;
const GH_API_DYNAMIC_METHOD_RE = /["']gh["']\s*,\s*(?:\[\s*)?["']api["'][\s\S]{0,1800}?["'](?:--method|-X)["']\s*,\s*(?!["'])/g;
const GH_GRAPHQL_INVOCATION_RE = /["']gh["']\s*,\s*(?:\[\s*)?["']api["']\s*,\s*["']graphql["']/i;
const MUTATING_METHOD_RE = /(?:["']--method["']\s*,\s*["'](?:POST|PATCH|PUT|DELETE)["']|["']-X["']\s*,\s*["'](?:POST|PATCH|PUT|DELETE)["']|["']--method=(?:POST|PATCH|PUT|DELETE)["'])/i;
const GRAPHQL_MUTATION_RE = /\bmutation\s*(?:\([^)]*\))?\s*\{/i;
const GIT_PUSH_RE = /["']git["']\s*,\s*(?:\[\s*)?["']push["']/g;

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

function error(path, code, message) {
  return { path, code, message };
}

function hasError(errors, code) {
  return errors.some((item) => item.code === code);
}

export function validateMutationBoundarySource(path, source) {
  path = portable(path);
  if (APPROVED_MUTATION_FILES.has(path)) return [];
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

  GH_API_RE.lastIndex = 0;
  for (const match of source.matchAll(GH_API_RE)) {
    const window = match[0];
    if (MUTATING_METHOD_RE.test(window)) {
      errors.push(
        error(
          path,
          "direct_gh_api_mutation",
          "Mutating gh api calls must route through the mutation broker.",
        ),
      );
    }
    if (/\bgraphql\b/i.test(window) && GRAPHQL_MUTATION_RE.test(window)) {
      errors.push(
        error(
          path,
          "direct_graphql_mutation",
          "GitHub GraphQL mutations must route through the mutation broker.",
        ),
      );
    }
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
    GH_GRAPHQL_INVOCATION_RE.test(source) &&
    GRAPHQL_MUTATION_RE.test(source)
  ) {
    errors.push(
      error(
        path,
        "direct_graphql_mutation",
        "GitHub GraphQL mutations must route through the mutation broker.",
      ),
    );
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

  return errors;
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
    approvedMutationFiles: [...APPROVED_MUTATION_FILES].sort(),
    errors,
  };
}
