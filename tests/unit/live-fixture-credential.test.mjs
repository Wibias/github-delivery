import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCredentialReport,
  evaluateInstallationRepositoryScope,
  parseCredentialArgs,
} from "../../scripts/lib/live-fixture-credential.mjs";

const IDENTITY_ARGS = [
  "--source-repo",
  "acme/source",
  "--fixture-repo-id",
  "12345",
  "--installation-id",
  "67890",
];

function parse(argv) {
  return parseCredentialArgs(argv, {});
}

function validRepositoryScope() {
  return evaluateInstallationRepositoryScope({
    installationId: 67890,
    fixtureRepoId: 12345,
    payload: {
      total_count: 1,
      repositories: [{ id: 12345, full_name: "acme/widget" }],
    },
  });
}

test("parses repository, source identity, target id, installation id, and optional base branch", () => {
  assert.deepEqual(parse(["acme/widget", ...IDENTITY_ARGS]), {
    repo: "acme/widget",
    base: "main",
    sourceRepo: "acme/source",
    fixtureRepoId: 12345,
    installationId: 67890,
  });
  assert.deepEqual(
    parse(["acme/widget", ...IDENTITY_ARGS, "--base", "dev"]),
    {
      repo: "acme/widget",
      base: "dev",
      sourceRepo: "acme/source",
      fixtureRepoId: 12345,
      installationId: 67890,
    },
  );
});

test("rejects malformed or incomplete credential verifier arguments", () => {
  assert.throws(() => parse([]), /OWNER\/REPO/);
  assert.throws(() => parse(["widget", ...IDENTITY_ARGS]), /OWNER\/REPO/);
  assert.throws(() => parse(["acme/widget", "--base"]), /--base/);
  assert.throws(
    () =>
      parse([
        "acme/widget",
        "--source-repo",
        "acme/source",
        "--installation-id",
        "67890",
      ]),
    /fixture-repo-id|Usage/,
  );
  assert.throws(
    () =>
      parse([
        "acme/widget",
        "--fixture-repo-id",
        "123",
        "--installation-id",
        "67890",
      ]),
    /source-repo|Usage/,
  );
  assert.throws(
    () =>
      parse([
        "acme/widget",
        "--source-repo",
        "acme/source",
        "--fixture-repo-id",
        "123",
      ]),
    /installation-id|Usage/,
  );
  assert.throws(() => parse(["acme/widget", ...IDENTITY_ARGS, "--wat"]), /Unknown option/);
});

test("installation scope is valid only when the token can access exactly the fixture repository", () => {
  assert.equal(validRepositoryScope().valid, true);

  const broad = evaluateInstallationRepositoryScope({
    installationId: 67890,
    fixtureRepoId: 12345,
    payload: {
      total_count: 2,
      repositories: [
        { id: 12345, full_name: "acme/widget" },
        { id: 99999, full_name: "acme/source" },
      ],
    },
  });
  assert.equal(broad.valid, false);
  assert.match(broad.reason, /scope_invalid/);

  const wrong = evaluateInstallationRepositoryScope({
    installationId: 67890,
    fixtureRepoId: 12345,
    payload: {
      total_count: 1,
      repositories: [{ id: 99999, full_name: "acme/other" }],
    },
  });
  assert.equal(wrong.valid, false);
});

test("builds a complete report only when every required read and repository scope check succeeds", () => {
  const report = buildCredentialReport({
    repo: "acme/widget",
    base: "main",
    login: "fixture-app[bot]",
    repositoryScope: validRepositoryScope(),
    probes: {
      repository: { ok: true },
      actions: { ok: true },
      checks: { ok: true },
      statuses: { ok: true },
      activeRules: { ok: true },
      branchProtectionGraphql: { ok: true },
    },
  });
  assert.equal(report.valid, true);
  assert.equal(report.login, "fixture-app[bot]");
  assert.equal(report.installationId, 67890);
  assert.deepEqual(report.repositoryScope.repositoryIds, [12345]);
  assert.deepEqual(report.failures, []);
});

test("reports exact missing capabilities without manufacturing success", () => {
  const report = buildCredentialReport({
    repo: "acme/widget",
    base: "main",
    login: "fixture-app[bot]",
    repositoryScope: validRepositoryScope(),
    probes: {
      repository: { ok: true },
      actions: { ok: false, error: "actions denied" },
      checks: { ok: true },
      statuses: { ok: false, error: "statuses denied" },
      activeRules: { ok: false, error: "rules denied" },
      branchProtectionGraphql: { ok: false, error: "graphql denied" },
    },
  });
  assert.equal(report.valid, false);
  assert.deepEqual(
    report.failures.map((failure) => failure.capability),
    ["actions", "statuses", "activeRules", "branchProtectionGraphql"],
  );
  assert.doesNotMatch(JSON.stringify(report), /token/i);
});

test("credential report fails closed when installation repository scope is broad or absent", () => {
  const broadScope = evaluateInstallationRepositoryScope({
    installationId: 67890,
    fixtureRepoId: 12345,
    payload: {
      total_count: 2,
      repositories: [
        { id: 12345, full_name: "acme/widget" },
        { id: 99999, full_name: "acme/source" },
      ],
    },
  });
  const report = buildCredentialReport({
    repo: "acme/widget",
    base: "main",
    login: "fixture-app[bot]",
    repositoryScope: broadScope,
    probes: Object.fromEntries(
      [
        "repository",
        "actions",
        "checks",
        "statuses",
        "activeRules",
        "branchProtectionGraphql",
      ].map((name) => [name, { ok: true }]),
    ),
  });
  assert.equal(report.valid, false);
  assert.ok(
    report.failures.some((failure) => failure.capability === "repositoryScope"),
  );
});
