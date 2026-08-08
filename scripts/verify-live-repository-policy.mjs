#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { evaluateLiveRepositoryPolicy } from "./lib/workflow-security.mjs";

const USAGE = "Usage: node scripts/verify-live-repository-policy.mjs OWNER/REPO [ROOT]";

function ghJson(path) {
  const result = spawnSync("gh", ["api", path], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new Error(detail || `github_read_failed:${path}`);
  }
  try {
    return JSON.parse(String(result.stdout || ""));
  } catch {
    throw new Error(`github_invalid_json:${path}`);
  }
}

function main(argv) {
  const [repo, rootArg] = argv;
  if (!repo?.includes("/") || argv.length > 2) throw new Error(USAGE);
  const root = resolve(rootArg || process.cwd());
  const policy = JSON.parse(
    readFileSync(resolve(root, ".github", "repository-policy.json"), "utf8"),
  );

  const repository = ghJson(`repos/${repo}`);
  const defaultBranch = repository.default_branch;
  if (!defaultBranch) throw new Error("default_branch_missing");
  const branch = ghJson(`repos/${repo}/branches/${encodeURIComponent(defaultBranch)}`);
  const activeRules = ghJson(
    `repos/${repo}/rules/branches/${encodeURIComponent(defaultBranch)}`,
  );
  const releaseEnvironment = ghJson(
    `repos/${repo}/environments/${encodeURIComponent(policy.release.environment)}`,
  );

  const report = evaluateLiveRepositoryPolicy({
    policy,
    live: { repository, branch, activeRules, releaseEnvironment },
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
