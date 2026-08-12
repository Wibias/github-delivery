import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { runBootstrapDoctor } from "../../scripts/lib/bootstrap-maintenance.mjs";

const TARGET = resolve("/tmp/github-delivery-authority-doctor");

function baseDependencies({ mode = "off", authority } = {}) {
  return {
    checkBootstrapEnvironment: () => ({ ok: true }),
    discoverInstallations: () => [{ target: TARGET, valid: true, version: "0.5.1", reason: null }],
    readInstalledManifest: () => ({
      schemaVersion: 1,
      kind: "github-delivery/distribution-manifest",
      name: "github-delivery",
      version: "0.5.1",
      sourceCommit: "a".repeat(40),
      files: [],
    }),
    compareInstalledManifest: () => ({ clean: true, modifications: [] }),
    readUserConfig: () => ({ source: "file", config: { schemaVersion: 1, authorityMode: mode } }),
    readInstalledAuthorityHost: () => authority,
    readActivationReceipt: () => null,
    latestRelease: async () => ({ tag_name: "v0.5.1", draft: false, prerelease: false, assets: [] }),
  };
}

test("doctor reports a required missing Authority host explicitly", async () => {
  const report = await runBootstrapDoctor({
    target: TARGET,
    dependencies: baseDependencies({
      mode: "high-assurance",
      authority: {
        supported: true,
        configured: false,
        installed: false,
        legacy: false,
        version: null,
        sourceCommit: null,
      },
    }),
  });

  assert.equal(report.authorityHost.requiredByMode, true);
  assert.equal(report.authorityHost.relation, "missing");
  assert.equal(report.authorityHost.error, null);
});

test("doctor distinguishes a legacy Authority host from a version update", async () => {
  const report = await runBootstrapDoctor({
    target: TARGET,
    dependencies: baseDependencies({
      mode: "off",
      authority: {
        supported: true,
        configured: true,
        installed: true,
        legacy: true,
        version: null,
        sourceCommit: null,
      },
    }),
  });

  assert.equal(report.authorityHost.requiredByMode, false);
  assert.equal(report.authorityHost.relation, "legacy");
});

test("doctor surfaces an unsupported required Authority host", async () => {
  const report = await runBootstrapDoctor({
    target: TARGET,
    dependencies: baseDependencies({
      mode: "all",
      authority: {
        supported: false,
        configured: false,
        installed: false,
        legacy: false,
        version: null,
        sourceCommit: null,
      },
    }),
  });

  assert.equal(report.authorityHost.requiredByMode, true);
  assert.equal(report.authorityHost.relation, null);
  assert.equal(report.authorityHost.error, "authority_host_required_unsupported");
});
