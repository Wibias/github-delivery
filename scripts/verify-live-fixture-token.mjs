#!/usr/bin/env node
import { spawnSync } from "node:child_process";

import { runGitHubCommandWithRetry } from "./lib/github-retry.mjs";
import {
  buildCredentialReport,
  evaluateInstallationRepositoryScope,
  parseCredentialArgs,
} from "./lib/live-fixture-credential.mjs";
import { verifyFixtureTargetIdentity } from "./lib/live-fixture-identity.mjs";

function execute(command, args, options = {}) {
  if (command === "gh") return runGitHubCommandWithRetry(command, args, { options });
  return spawnSync(command, args, options);
}

function runGh(args) {
  const result = execute("gh", args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    stdout: String(result.stdout || "").trim(),
    error: String(result.stderr || result.stdout || "").trim() || null,
  };
}

function runGhJson(args, context) {
  const result = runGh(args);
  if (!result.ok) {
    throw new Error(`${context}:${result.error || "github request failed"}`);
  }
  try {
    return JSON.parse(result.stdout || "null");
  } catch {
    throw new Error(`${context}:invalid_json`);
  }
}

function probe(args) {
  const result = runGh(args);
  return { ok: result.ok, error: result.error };
}

function branchProtectionQuery() {
  return `
    query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        branchProtectionRules(first: 1) {
          pageInfo { hasNextPage }
          nodes { pattern }
        }
      }
    }`;
}

try {
  const { repo, base, sourceRepo, fixtureRepoId, installationId } =
    parseCredentialArgs(process.argv.slice(2));
  if (!process.env.GH_TOKEN) {
    throw new Error(
      "missing_live_fixture_token: create a fixture-scoped GitHub App installation token",
    );
  }

  verifyFixtureTargetIdentity({
    sourceRepo,
    fixtureRepo: repo,
    expectedFixtureRepoId: fixtureRepoId,
    baseBranch: base,
    runner: execute,
  });

  const installationRepositories = runGhJson(
    ["api", "installation/repositories?per_page=100"],
    "live_fixture_installation_repositories_unreadable",
  );
  const repositoryScope = evaluateInstallationRepositoryScope({
    installationId,
    fixtureRepoId,
    payload: installationRepositories,
  });

  const [owner, name] = repo.split("/");
  const identity = runGh(["api", "user", "--jq", ".login"]);
  if (!identity.ok || !identity.stdout) {
    throw new Error(
      `live_fixture_token_identity_unreadable: ${identity.error || "empty login"}`,
    );
  }

  const encodedBase = encodeURIComponent(base);
  const probes = {
    repository: probe(["api", `repos/${repo}`]),
    actions: probe(["api", `repos/${repo}/actions/runs?per_page=1`]),
    checks: probe([
      "api",
      `repos/${repo}/commits/${encodedBase}/check-runs?per_page=1`,
    ]),
    statuses: probe([
      "api",
      `repos/${repo}/commits/${encodedBase}/statuses?per_page=1`,
    ]),
    activeRules: probe([
      "api",
      `repos/${repo}/rules/branches/${encodedBase}`,
    ]),
    branchProtectionGraphql: probe([
      "api",
      "graphql",
      "-f",
      `query=${branchProtectionQuery()}`,
      "-F",
      `owner=${owner}`,
      "-F",
      `name=${name}`,
    ]),
  };

  const report = buildCredentialReport({
    repo,
    base,
    login: identity.stdout,
    probes,
    repositoryScope,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.valid) {
    process.exitCode = 2;
  }
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
