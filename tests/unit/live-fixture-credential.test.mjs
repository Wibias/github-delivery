import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCredentialReport,
  parseCredentialArgs,
} from "../../scripts/lib/live-fixture-credential.mjs";

test("parses a repository and optional base branch", () => {
  assert.deepEqual(parseCredentialArgs(["acme/widget"]), {
    repo: "acme/widget",
    base: "main",
  });
  assert.deepEqual(parseCredentialArgs(["acme/widget", "--base", "dev"]), {
    repo: "acme/widget",
    base: "dev",
  });
});

test("rejects malformed credential verifier arguments", () => {
  assert.throws(() => parseCredentialArgs([]), /OWNER\/REPO/);
  assert.throws(() => parseCredentialArgs(["widget"]), /OWNER\/REPO/);
  assert.throws(() => parseCredentialArgs(["acme/widget", "--base"]), /--base/);
  assert.throws(() => parseCredentialArgs(["acme/widget", "--wat"]), /Unknown option/);
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
