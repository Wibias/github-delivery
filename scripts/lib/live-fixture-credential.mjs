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

  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === "--base") {
      const next = argv[++index];
      if (!next || next.startsWith("--")) {
        throw new Error("--base requires a branch name");
      }
      base = next;
    } else if (value.startsWith("--")) {
      throw new Error(`Unknown option: ${value}`);
    } else {
      positionals.push(value);
    }
  }

  if (positionals.length !== 1 || !positionals[0]?.includes("/")) {
    throw new Error(
      "Usage: node scripts/verify-live-fixture-token.mjs OWNER/REPO [--base BRANCH]",
    );
  }

  return { repo: positionals[0], base };
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
