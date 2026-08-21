#!/usr/bin/env node
import { boundedSpawnSync } from "./lib/subprocess-policy.mjs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  evaluateLiveRepositoryPolicy,
  rulesetBypassFieldsComplete,
} from "./lib/workflow-security.mjs";

const USAGE = "Usage: node scripts/verify-live-repository-policy.mjs OWNER/REPO [ROOT]";

function runGhJson(args, context) {
  const result = boundedSpawnSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new Error(detail || `github_read_failed:${context}`);
  }
  try {
    return JSON.parse(String(result.stdout || ""));
  } catch {
    throw new Error(`github_invalid_json:${context}`);
  }
}

function ghJson(path) {
  return runGhJson(["api", path], path);
}

function ghJsonOptional(path) {
  try {
    return ghJson(path);
  } catch {
    return null;
  }
}

function ghJsonPaginated(path) {
  const pages = runGhJson(["api", path, "--paginate", "--slurp"], path);
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
    throw new Error(`github_paginated_payload_invalid:${path}`);
  }
  return pages.flat();
}

function ghRepositoryMergeSettings(repo) {
  const [owner, name] = repo.split("/");
  const query = `
    query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        mergeCommitAllowed
        squashMergeAllowed
        rebaseMergeAllowed
        autoMergeAllowed
        allowUpdateBranch
      }
    }
  `;
  const payload = runGhJson(
    [
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-F",
      `owner=${owner}`,
      "-F",
      `name=${name}`,
    ],
    `graphql:repository:${repo}`,
  );
  const settings = payload?.data?.repository;
  const required = [
    "mergeCommitAllowed",
    "squashMergeAllowed",
    "rebaseMergeAllowed",
    "autoMergeAllowed",
    "allowUpdateBranch",
  ];
  if (!settings || required.some((field) => typeof settings[field] !== "boolean")) {
    throw new Error(`github_repository_merge_settings_unreadable:${repo}`);
  }
  return {
    allow_merge_commit: settings.mergeCommitAllowed,
    allow_squash_merge: settings.squashMergeAllowed,
    allow_rebase_merge: settings.rebaseMergeAllowed,
    allow_auto_merge: settings.autoMergeAllowed,
    allow_update_branch: settings.allowUpdateBranch,
  };
}

function activeRulesetPath(repo, rule) {
  const id = Number(rule?.ruleset_id);
  const sourceType = String(rule?.ruleset_source_type || "");
  const source = String(rule?.ruleset_source || "");
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("active_ruleset_id_missing");
  }
  if (sourceType === "Repository") {
    return `repos/${repo}/rulesets/${id}`;
  }
  if (sourceType === "Organization" && source) {
    return `orgs/${source}/rulesets/${id}`;
  }
  if (sourceType === "Enterprise" && source) {
    return `enterprises/${source}/rulesets/${id}`;
  }
  throw new Error(
    `active_ruleset_source_unsupported:${sourceType || "missing"}:${source || "missing"}:${id}`,
  );
}

function fetchActiveRulesets(repo, activeRules) {
  const paths = new Map();
  for (const rule of activeRules || []) {
    const path = activeRulesetPath(repo, rule);
    paths.set(path, true);
  }
  return [...paths.keys()].sort().map((path) => ghJson(path));
}

function main(argv) {
  const [repo, rootArg] = argv;
  if (!repo?.includes("/") || argv.length > 2) throw new Error(USAGE);
  const root = resolve(rootArg || process.cwd());
  const policy = JSON.parse(
    readFileSync(resolve(root, ".github", "repository-policy.json"), "utf8"),
  );

  const repository = {
    ...ghJson(`repos/${repo}`),
    ...ghRepositoryMergeSettings(repo),
  };
  const defaultBranch = repository.default_branch;
  if (!defaultBranch) throw new Error("default_branch_missing");
  const branch = ghJson(`repos/${repo}/branches/${encodeURIComponent(defaultBranch)}`);
  const activeRules = ghJsonPaginated(
    `repos/${repo}/rules/branches/${encodeURIComponent(defaultBranch)}?per_page=100`,
  );
  const activeRulesets = fetchActiveRulesets(repo, activeRules);
  const viewer = ghJsonOptional("user");
  const releaseEnvironment = ghJson(
    `repos/${repo}/environments/${encodeURIComponent(policy.release.environment)}`,
  );

  const report = evaluateLiveRepositoryPolicy({
    policy,
    live: {
      repository,
      viewer,
      branch,
      activeRules,
      activeRulesets,
      activeRulesetsComplete: rulesetBypassFieldsComplete(activeRulesets),
      releaseEnvironment,
    },
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.valid) process.exitCode = 1;
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(String(error?.message || error));
  process.exitCode = 2;
}
