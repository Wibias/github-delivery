const CAPABILITIES = [
  "repository",
  "actions",
  "checks",
  "statuses",
  "activeRules",
  "branchProtectionGraphql",
];

function positiveInteger(value, code) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`${code}_invalid`);
  }
  return number;
}

export function parseCredentialArgs(argv, env = process.env) {
  const positionals = [];
  let base = "main";
  let sourceRepo = env.GITHUB_REPOSITORY || null;
  let fixtureRepoId = env.LIVE_FIXTURE_REPOSITORY_ID || null;
  let installationId = env.LIVE_FIXTURE_INSTALLATION_ID || null;

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
    } else if (value === "--installation-id") {
      installationId = argv[++index];
      if (!installationId || installationId.startsWith("--")) {
        throw new Error("--installation-id requires an integer installation id");
      }
    } else if (value.startsWith("--")) {
      throw new Error(`Unknown option: ${value}`);
    } else {
      positionals.push(value);
    }
  }

  const numericFixtureRepoId = Number(fixtureRepoId);
  const numericInstallationId = Number(installationId);
  if (
    positionals.length !== 1 ||
    !positionals[0]?.includes("/") ||
    !sourceRepo?.includes("/") ||
    !Number.isSafeInteger(numericFixtureRepoId) ||
    numericFixtureRepoId <= 0 ||
    !Number.isSafeInteger(numericInstallationId) ||
    numericInstallationId <= 0
  ) {
    throw new Error(
      "Usage: node scripts/verify-live-fixture-token.mjs OWNER/REPO --source-repo OWNER/REPO --fixture-repo-id ID --installation-id ID [--base BRANCH]",
    );
  }

  return {
    repo: positionals[0],
    base,
    sourceRepo,
    fixtureRepoId: numericFixtureRepoId,
    installationId: numericInstallationId,
  };
}

export function evaluateInstallationRepositoryScope({
  installationId,
  fixtureRepoId,
  payload,
} = {}) {
  installationId = positiveInteger(installationId, "installation_id");
  fixtureRepoId = positiveInteger(fixtureRepoId, "fixture_repo_id");
  const totalCount = Number(payload?.total_count);
  const repositories = Array.isArray(payload?.repositories)
    ? payload.repositories
    : [];
  const repositoryIds = repositories
    .map((repository) => Number(repository?.id))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  const repositoryNames = repositories
    .map((repository) => String(repository?.full_name || ""))
    .filter(Boolean);
  const valid =
    Number.isSafeInteger(totalCount) &&
    totalCount === 1 &&
    repositories.length === 1 &&
    repositoryIds.length === 1 &&
    repositoryIds[0] === fixtureRepoId;
  return {
    valid,
    installationId,
    totalCount: Number.isSafeInteger(totalCount) ? totalCount : null,
    repositoryIds,
    repositoryNames,
    reason: valid
      ? null
      : `fixture_installation_scope_invalid: expected only repository ${fixtureRepoId}`,
  };
}

export function buildCredentialReport({
  repo,
  base,
  login,
  probes = {},
  repositoryScope = null,
} = {}) {
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

  const scopeValid = repositoryScope?.valid === true;
  if (!scopeValid) {
    failures.push({
      capability: "repositoryScope",
      error: String(
        repositoryScope?.reason ||
          "fixture_installation_scope_unverified",
      ),
    });
  }

  return {
    schemaVersion: 1,
    kind: "github-delivery/live-fixture-credential-report",
    repo,
    base,
    login: login || null,
    installationId: repositoryScope?.installationId || null,
    valid: Boolean(login) && failures.length === 0,
    capabilities,
    repositoryScope: repositoryScope
      ? {
          valid: scopeValid,
          totalCount: repositoryScope.totalCount,
          repositoryIds: repositoryScope.repositoryIds || [],
          repositoryNames: repositoryScope.repositoryNames || [],
        }
      : { valid: false, totalCount: null, repositoryIds: [], repositoryNames: [] },
    failures,
  };
}
