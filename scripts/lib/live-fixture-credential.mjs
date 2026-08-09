const CAPABILITIES = [
  "repository",
  "actions",
  "checks",
  "statuses",
  "activeRules",
  "branchProtectionGraphql",
];

export function parseCredentialArgs(argv) {
  const positionals = [];
  let base = "main";
  let sourceRepo = process.env.GITHUB_REPOSITORY || null;
  let fixtureRepoId = process.env.LIVE_FIXTURE_REPOSITORY_ID || null;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--base") {
      const next = argv[++index];
      if (!next || next.startsWith("--")) {
        throw new Error("--base requires a branch name");
      }
      base = next;
    } else if (value === "--source-repo") {
      sourceRepo = argv[++index];
      if (!sourceRepo || sourceRepo.startsWith("--")) {
        throw new Error("--source-repo requires OWNER/REPO");
      }
    } else if (value === "--fixture-repo-id") {
      fixtureRepoId = argv[++index];
      if (!fixtureRepoId || fixtureRepoId.startsWith("--")) {
        throw new Error("--fixture-repo-id requires an integer repository id");
      }
    } else if (value.startsWith("--")) {
      throw new Error(`Unknown option: ${value}`);
    } else {
      positionals.push(value);
    }
  }

  const numericFixtureRepoId = Number(fixtureRepoId);
  if (
    positionals.length !== 1 ||
    !positionals[0]?.includes("/") ||
    !sourceRepo?.includes("/") ||
    !Number.isSafeInteger(numericFixtureRepoId) ||
    numericFixtureRepoId <= 0
  ) {
    throw new Error(
      "Usage: node scripts/verify-live-fixture-token.mjs OWNER/REPO --source-repo OWNER/REPO --fixture-repo-id ID [--base BRANCH]",
    );
  }

  return {
    repo: positionals[0],
    base,
    sourceRepo,
    fixtureRepoId: numericFixtureRepoId,
  };
}

export function buildCredentialReport({ repo, base, login, probes = {} } = {}) {
  const failures = [];
  const capabilities = {};

  for (const capability of CAPABILITIES) {
    const probe = probes[capability] || {};
    const ok = probe.ok === true;
    capabilities[capability] = { ok };
    if (!ok) {
      failures.push({
        capability,
        error: String(probe.error || `${capability} probe failed`),
      });
    }
  }

  return {
    schemaVersion: 1,
    kind: "github-delivery/live-fixture-credential-report",
    repo,
    base,
    login: login || null,
    valid: Boolean(login) && failures.length === 0,
    capabilities,
    failures,
  };
}
