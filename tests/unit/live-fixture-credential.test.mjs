import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCredentialReport,
  parseCredentialArgs,
} from "../../scripts/lib/live-fixture-credential.mjs";

const IDENTITY_ARGS = [
  "--source-repo",
  "acme/source",
  "--fixture-repo-id",
  "12345",
];

function parse(argv) {
  return parseCredentialArgs(argv, {});
}

test("parses repository, source identity, target id, and optional base branch", () => {
  assert.deepEqual(parse(["acme/widget", ...IDENTITY_ARGS]), {
    repo: "acme/widget",
    base: "main",
    sourceRepo: "acme/source",
    fixtureRepoId: 12345,
  });
  assert.deepEqual(
    parse(["acme/widget", ...IDENTITY_ARGS, "--base", "dev"]),
    {
      repo: "acme/widget",
      base: "dev",
      sourceRepo: "acme/source",
      fixtureRepoId: 12345,
    },
  );
});

test("rejects malformed or incomplete credential verifier arguments", () => {
  assert.throws(() => parse([]), /OWNER\/REPO/);
  assert.throws(() => parse(["widget", ...IDENTITY_ARGS]), /OWNER\/REPO/);
  assert.throws(() => parse(["acme/widget", "--base"]), /--base/);
  assert.throws(
    () => parse(["acme/widget", "--source-repo", "acme/source"]),
    /fixture-repo-id|Usage/,
  );
  assert.throws(
    () => parse(["acme/widget", "--fixture-repo-id", "123"]),
    /source-repo|Usage/,
  );
  assert.throws(
    () => parse(["acme/widget", ...IDENTITY_ARGS.slice(0, -1), "nope"]),
    /fixture-repo-id|Usage/,
  );
  assert.throws(() => parse(["acme/widget", ...IDENTITY_ARGS, "--wat"]), /Unknown option/);
});

test("builds a complete report only when every required read succeeds", () => {
  const report = buildCredentialReport({
    repo: "acme/widget",
    base: "main",
    login: "maintainer",
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
  assert.equal(report.login, "maintainer");
  assert.deepEqual(report.failures, []);
});

test("reports exact missing capabilities without manufacturing success", () => {
  const report = buildCredentialReport({
    repo: "acme/widget",
    base: "main",
    login: "maintainer",
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
