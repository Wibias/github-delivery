import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  runBootstrapDoctor,
  runBootstrapSetup,
  runBootstrapUpdate,
} from "../../scripts/lib/bootstrap-maintenance.mjs";
import { runBootstrap } from "../../scripts/lib/bootstrap-command.mjs";

const TARGET = resolve("/tmp/github-delivery-installed");
const CODEX_HOME = resolve("/tmp/codex-home");
const AUTHORITY_NOOP = Object.freeze({
  action: "unsupported",
  changed: false,
  installed: { supported: false, installed: false },
});

function validInstallation(version = "0.4.0") {
  return [{ target: TARGET, valid: true, version, reason: null }];
}

function legacyInstallation(version = "0.4.0") {
  return [{
    target: TARGET,
    valid: false,
    migratable: true,
    legacy: true,
    version,
    reason: "legacy_manifestless",
  }];
}

function authorityNoopDependencies(extra = {}) {
  return {
    reconcileStableAuthorityHost: async () => ({ ...AUTHORITY_NOOP }),
    ...extra,
  };
}

test("update always delegates through the installed target explicitly", async () => {
  const seen = [];
  const result = await runBootstrapUpdate({
    target: TARGET,
    apply: true,
    dependencies: {
      parseInstallArgs(argv) {
        seen.push(argv);
        return {
          update: true,
          target: TARGET,
          targetExplicit: true,
          apply: true,
          sourceExplicit: false,
          allowDowngrade: false,
          force: false,
        };
      },
      async runInstallCommand(options) {
        seen.push(options);
        return { action: "update", apply: true, updated: true, target: TARGET };
      },
    },
  });

  assert.deepEqual(seen[0], ["--update", "--target", TARGET, "--apply"]);
  assert.equal(seen[1].targetExplicit, true);
  assert.equal(seen[1].sourceExplicit, false);
  assert.equal(seen[1].allowDowngrade, false);
  assert.equal(seen[1].force, false);
  assert.equal(result.updated, true);
});

test("setup fails clearly when no valid installed skill exists", async () => {
  await assert.rejects(
    runBootstrapSetup({
      target: TARGET,
      codexHome: CODEX_HOME,
      dependencies: { discoverInstallations: () => [] },
    }),
    /bootstrap_setup_installation_missing/,
  );
});

test("setup leaves a healthy activation untouched after authority reconciliation", async () => {
  let mutations = 0;
  let authorityCalls = 0;
  const authorityHost = { action: "already_current", changed: false, installed: { supported: true, installed: true, version: "0.5.1" } };
  const result = await runBootstrapSetup({
    target: TARGET,
    codexHome: CODEX_HOME,
    dependencies: {
      discoverInstallations: () => validInstallation(),
      async reconcileStableAuthorityHost(options) {
        authorityCalls += 1;
        assert.equal(options.scriptPath, join(TARGET, "authority-host", "windows", "install-release.ps1"));
        return authorityHost;
      },
      readActivationReceipt: () => ({
        schemaVersion: 1,
        mode: "hooks",
        degradationReason: "streaming_interruption_unavailable",
        hooksConfigured: true,
        hookTrustVerified: true,
      }),
      inspectHooks() {
        mutations += 1;
        throw new Error("healthy setup must not rewrite hooks");
      },
      loadInstalledInstaller() {
        mutations += 1;
        throw new Error("healthy setup must not reload installer");
      },
    },
  });

  assert.equal(authorityCalls, 1);
  assert.equal(mutations, 0);
  assert.deepEqual(result, {
    action: "setup",
    status: "ready",
    target: TARGET,
    watchdog: "hooks",
    changed: false,
    authorityHost,
  });
});

test("setup surfaces an authority-host repair even when watchdog activation is already healthy", async () => {
  const authorityHost = {
    action: "upgrade_legacy",
    changed: true,
    installed: { supported: true, installed: true, legacy: false, version: "0.5.1" },
  };
  const result = await runBootstrapSetup({
    target: TARGET,
    codexHome: CODEX_HOME,
    dependencies: {
      discoverInstallations: () => validInstallation("0.5.1"),
      reconcileStableAuthorityHost: async () => authorityHost,
      readActivationReceipt: () => ({ mode: "hooks", hooksConfigured: true, hookTrustVerified: true }),
    },
  });
  assert.equal(result.status, "ready");
  assert.equal(result.changed, true);
  assert.deepEqual(result.authorityHost, authorityHost);
});

test("setup never applies a trust assertion when the installed hook definition would change", async () => {
  let confirmed = 0;
  let installerLoads = 0;
  const result = await runBootstrapSetup({
    target: TARGET,
    codexHome: CODEX_HOME,
    dependencies: authorityNoopDependencies({
      discoverInstallations: () => validInstallation(),
      readActivationReceipt: () => ({
        schemaVersion: 1,
        mode: "none",
        degradationReason: "hook_trust_required",
        hooksConfigured: true,
        hookTrustVerified: false,
      }),
      inspectHooks(options) {
        assert.equal(options.apply, false);
        assert.equal(options.skillDir, TARGET);
        assert.equal(options.hooksPath, join(CODEX_HOME, "hooks.json"));
        return { wouldChange: true, applied: false };
      },
      async confirmTrust() {
        confirmed += 1;
        return true;
      },
      loadInstalledInstaller() {
        installerLoads += 1;
        throw new Error("changed hooks must not reach activation apply");
      },
    }),
  });

  assert.equal(confirmed, 0);
  assert.equal(installerLoads, 0);
  assert.equal(result.status, "hook_trust_required");
  assert.equal(result.hookDefinitionChanged, true);
  assert.deepEqual(result.authorityHost, AUTHORITY_NOOP);
  assert.match(result.guidance, /\/hooks/);
});

test("setup refreshes activation only through the installer inside the installed target", async () => {
  const events = [];
  const result = await runBootstrapSetup({
    target: TARGET,
    codexHome: CODEX_HOME,
    dependencies: authorityNoopDependencies({
      discoverInstallations: () => validInstallation(),
      readActivationReceipt: () => ({
        schemaVersion: 1,
        mode: "none",
        degradationReason: "hook_trust_required",
        hooksConfigured: true,
        hookTrustVerified: false,
      }),
      inspectHooks() {
        events.push("inspect");
        return { wouldChange: false, applied: false };
      },
      async confirmTrust() {
        events.push("confirm");
        return true;
      },
      async loadInstalledInstaller(modulePath) {
        events.push(`load:${modulePath}`);
        assert.equal(modulePath, join(TARGET, "scripts", "install-skill.mjs"));
        return {
          parseInstallArgs(argv) {
            events.push(`parse:${argv.join("|")}`);
            assert.deepEqual(argv, [
              "--source", TARGET,
              "--target", TARGET,
              "--host", "codex",
              "--codex-home", CODEX_HOME,
              "--hook-trust-verified",
              "--apply",
            ]);
            return { source: TARGET, target: TARGET, host: "codex", hookTrustVerified: true, apply: true };
          },
          async runInstallCommand(options) {
            events.push("run");
            assert.equal(options.source, TARGET);
            assert.equal(options.target, TARGET);
            return { action: "same-version", watchdog: { mode: "hooks", hookTrustVerified: true } };
          },
        };
      },
    }),
  });

  assert.deepEqual(events.slice(0, 2), ["inspect", "confirm"]);
  assert(events[2].startsWith(`load:${join(TARGET, "scripts", "install-skill.mjs")}`));
  assert.equal(events.at(-1), "run");
  assert.equal(result.status, "ready");
  assert.equal(result.watchdog, "hooks");
  assert.deepEqual(result.authorityHost, AUTHORITY_NOOP);
});

test("doctor is read-only and reports integrity, activation, config, authority host, and update relation", async () => {
  const mutations = [];
  const manifest = {
    schemaVersion: 1,
    kind: "github-delivery/distribution-manifest",
    name: "github-delivery",
    version: "0.4.0",
    sourceCommit: "a".repeat(40),
    files: [],
  };
  const report = await runBootstrapDoctor({
    target: TARGET,
    codexHome: CODEX_HOME,
    dependencies: {
      checkBootstrapEnvironment: () => ({ ok: true, node: { ok: true }, git: { ok: true }, gh: { ok: true }, ghAuth: { ok: true } }),
      discoverInstallations: () => validInstallation(),
      readInstalledManifest: () => manifest,
      compareInstalledManifest: () => ({ clean: false, modifications: [{ path: "SKILL.md", reason: "changed" }] }),
      readUserConfig: () => ({ source: "default", config: { schemaVersion: 1, authorityMode: "off" } }),
      readInstalledAuthorityHost: () => ({ supported: true, installed: true, legacy: true, version: null, sourceCommit: null }),
      readActivationReceipt: () => ({ mode: "none", degradationReason: "hook_trust_required", hooksConfigured: true, hookTrustVerified: false }),
      async latestRelease() {
        return { tag_name: "v0.5.0", draft: false, prerelease: false, assets: [] };
      },
      installSkill() { mutations.push("install"); },
      writeUserConfig() { mutations.push("config"); },
      applyHooks() { mutations.push("hooks"); },
      authLogin() { mutations.push("auth"); },
    },
  });

  assert.deepEqual(mutations, []);
  assert.equal(report.target, TARGET);
  assert.equal(report.installed.version, "0.4.0");
  assert.equal(report.integrity.clean, false);
  assert.equal(report.config.ok, true);
  assert.equal(report.config.effectiveAuthorityMode, "off");
  assert.equal(report.activation.degradationReason, "hook_trust_required");
  assert.equal(report.authorityHost.ok, true);
  assert.equal(report.authorityHost.legacy, true);
  assert.equal(report.authorityHost.relation, "legacy");
  assert.equal(report.authorityHost.requiredByMode, false);
  assert.deepEqual(report.latest, { version: "0.5.0", relation: "update", error: null });
});

test("bare bootstrap starts fresh install when no valid installation exists", async () => {
  const calls = [];
  const result = await runBootstrap([], {
    discoverInstallations: () => [],
    async runGuidedInstall(options) {
      calls.push(options.target);
      return { action: "install", apply: false, installed: false };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(result.action, "install");
});

test("bare bootstrap never silently updates an existing installation", async () => {
  let updates = 0;
  const result = await runBootstrap([], {
    discoverInstallations: () => validInstallation(),
    async chooseExistingAction() {
      return "exit";
    },
    async runBootstrapUpdate() {
      updates += 1;
    },
  });
  assert.equal(updates, 0);
  assert.deepEqual(result, { action: "exit", target: TARGET });
});

test("update selects a recognized legacy manifestless installation while setup remains strict", async () => {
  const calls = [];
  const result = await runBootstrap(["update"], {
    discoverInstallations: () => legacyInstallation("0.5.1"),
    async runBootstrapUpdate(options) {
      calls.push(options);
      return { action: "migrate_legacy", apply: false, target: options.target };
    },
  });

  assert.deepEqual(calls, [{ target: TARGET, apply: false }]);
  assert.equal(result.action, "migrate_legacy");

  await assert.rejects(
    runBootstrap(["setup"], {
      discoverInstallations: () => legacyInstallation("0.5.1"),
    }),
    /bootstrap_setup_installation_missing/,
  );
});

test("doctor reports a recognized legacy installation without inventing file integrity", async () => {
  const report = await runBootstrapDoctor({
    target: TARGET,
    codexHome: CODEX_HOME,
    dependencies: {
      checkBootstrapEnvironment: () => ({ ok: true, node: { ok: true }, git: { ok: true }, gh: { ok: true }, ghAuth: { ok: true } }),
      discoverInstallations: () => legacyInstallation("0.5.1"),
      readInstalledManifest: () => { throw new Error("legacy doctor must not read a missing manifest"); },
      compareInstalledManifest: () => { throw new Error("legacy doctor must not claim integrity"); },
      readUserConfig: () => ({ source: "default", config: { schemaVersion: 1, authorityMode: "off" } }),
      readInstalledAuthorityHost: () => ({ supported: true, installed: false, legacy: false, version: null, sourceCommit: null }),
      readActivationReceipt: () => null,
      async latestRelease() {
        return { tag_name: "v0.5.2", draft: false, prerelease: false, assets: [] };
      },
    },
  });

  assert.equal(report.installed.ok, true);
  assert.equal(report.installed.version, "0.5.1");
  assert.equal(report.installed.legacyManifestless, true);
  assert.equal(report.integrity.ok, false);
  assert.equal(report.integrity.clean, null);
  assert.equal(report.integrity.error, "legacy_manifest_missing");
  assert.deepEqual(report.latest, { version: "0.5.2", relation: "update", error: null });
});
