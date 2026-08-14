import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  confirmApply,
  confirmAuthorityHost,
  runGuidedInstall,
} from "../../scripts/lib/bootstrap-install.mjs";
import { reconcileStableAuthorityHost } from "../../scripts/lib/authority-host-install.mjs";

function verifiedPayload(workspace, version = "0.5.0") {
  return {
    schemaVersion: 1,
    kind: "github-delivery/verified-release-payload",
    verified: true,
    source: join(workspace, "extracted", "github-delivery"),
    manifest: {
      schemaVersion: 1,
      kind: "github-delivery/distribution-manifest",
      name: "github-delivery",
      version,
      sourceCommit: "a".repeat(40),
      files: [],
    },
    release: { tag: `v${version}`, version, sourceCommit: "a".repeat(40) },
  };
}

const AUTHORITY_NOOP = Object.freeze({
  action: "unsupported",
  changed: false,
  installed: { supported: false, installed: false },
});

function dependencies(overrides = {}) {
  return {
    checkBootstrapEnvironment: () => ({
      ok: true,
      node: { ok: true, version: "24.0.0" },
      git: { ok: true, detail: "git available" },
      gh: { ok: true, detail: "gh available" },
      ghAuth: { ok: true, detail: "logged in" },
    }),
    makeWorkspace: () => "/tmp/github-delivery-bootstrap-test",
    removeWorkspace() {},
    discoverInstallations: () => [],
    async acquireVerifiedReleasePayload({ workspace }) {
      return verifiedPayload(workspace);
    },
    installSkill(options) {
      return {
        action: options.apply ? "install" : "install",
        apply: options.apply,
        sourceVersion: "0.5.0",
        targetVersion: null,
        target: options.target,
        backupPath: null,
        watchdog: { mode: "none", hookTrustRequired: false },
      };
    },
    readUserConfig: () => ({ config: { schemaVersion: 1, authorityMode: "off" } }),
    verifyInstalledRelease: () => ({ clean: true, modifications: [] }),
    reconcileStableAuthorityHost: async () => ({ ...AUTHORITY_NOOP }),
    confirmApply: async () => true,
    confirmAuthorityHost: async () => true,
    ...overrides,
  };
}

test("confirmApply defaults to no for blank, EOF, and anything except an explicit yes", async () => {
  for (const answer of ["", null, undefined, "n", "no", "wat"]) {
    assert.equal(await confirmApply("Apply?", { ask: async () => answer }), false);
  }
  for (const answer of ["y", "Y", "yes", "YES"]) {
    assert.equal(await confirmApply("Apply?", { ask: async () => answer }), true);
  }
});

test("confirmAuthorityHost defaults to install without prompting when input is not interactive", async () => {
  const installAuthorityHost = await confirmAuthorityHost({
    input: { isTTY: false },
    output: { write() {} },
    ask: async () => {
      throw new Error("non-interactive prompt must not run");
    },
  });

  assert.equal(installAuthorityHost, true);
});

test("confirmAuthorityHost explains the GUI and accepts yes/no answers with yes as the default", async () => {
  for (const [answer, expected] of [["", true], ["y", true], ["yes", true], ["n", false], ["no", false]]) {
    const writes = [];
    let prompt = null;
    const result = await confirmAuthorityHost({
      input: { isTTY: true },
      output: { write(value) { writes.push(value); } },
      ask: async (value) => {
        prompt = value;
        return answer;
      },
    });

    assert.equal(result, expected, `answer ${JSON.stringify(answer)}`);
    assert.match(writes.join(""), /Windows Hello/);
    assert.match(writes.join(""), /npx github-delivery setup/);
    assert.equal(prompt, "Install the Windows approval GUI now? [Y/n] ");
  }
});

test("confirmAuthorityHost reprompts instead of treating arbitrary input as approval", async () => {
  const answers = ["not sure", "n"];
  let prompts = 0;
  const result = await confirmAuthorityHost({
    input: { isTTY: true },
    output: { write() {} },
    ask: async () => {
      prompts += 1;
      return answers.shift();
    },
  });

  assert.equal(result, false);
  assert.equal(prompts, 2);
});

test("accepting the GUI prompt installs Authority even when protection mode is initially off", async () => {
  const target = resolve("/tmp/skills/github-delivery");
  let installed = false;
  let installCalls = 0;
  const expectedRelease = verifiedPayload("/tmp").release;
  const result = await runGuidedInstall({
    target,
    dependencies: dependencies({
      platform: "win32",
      confirmAuthorityHost: async () => true,
      reconcileStableAuthorityHost: (options) => reconcileStableAuthorityHost({
        ...options,
        platform: "win32",
        client: {
          async latestRelease() { return { tag_name: expectedRelease.tag }; },
        },
        dependencies: {
          readUserConfig: () => ({ config: { schemaVersion: 1, authorityMode: "off" } }),
          readInstalledAuthorityHost: () => installed
            ? { supported: true, configured: true, installed: true, legacy: false, version: expectedRelease.version, sourceCommit: expectedRelease.sourceCommit }
            : { supported: true, configured: false, installed: false, legacy: false, version: null, sourceCommit: null },
          makeWorkspace: () => "/tmp/authority-host-install",
          removeWorkspace() {},
          acquireVerifiedAuthorityHostPayload: async () => ({ verified: true }),
          installVerifiedAuthorityHost() {
            installCalls += 1;
            installed = true;
            return { status: 0 };
          },
        },
      }),
    }),
  });

  assert.equal(installCalls, 1);
  assert.equal(result.authorityHost.action, "install");
  assert.equal(result.authorityHost.changed, true);
});

test("declining the Windows approval GUI skips reconciliation but completes the skill install", async () => {
  let authorityCalls = 0;
  const target = resolve("/tmp/skills/github-delivery");
  const result = await runGuidedInstall({
    target,
    dependencies: dependencies({
      platform: "win32",
      confirmAuthorityHost: async () => false,
      reconcileStableAuthorityHost() {
        authorityCalls += 1;
        throw new Error("declined GUI must not reconcile Authority");
      },
    }),
  });

  assert.equal(result.action, "install");
  assert.deepEqual(result.authorityHost, { action: "skipped", changed: false });
  assert.equal(authorityCalls, 0);
});

test("guided install verifies a release, performs a dry-run, then reconciles Authority after apply", async () => {
  const events = [];
  const target = resolve("/tmp/skills/github-delivery");
  const result = await runGuidedInstall({
    target,
    host: "unknown",
    dependencies: dependencies({
      async acquireVerifiedReleasePayload({ workspace }) {
        events.push("acquire");
        return verifiedPayload(workspace);
      },
      installSkill(options) {
        events.push(`install:${options.apply}`);
        assert.equal(options.source, resolve("/tmp/github-delivery-bootstrap-test", "extracted", "github-delivery"));
        assert.equal(options.target, target);
        assert.equal(options.update, false);
        assert.equal(options.allowDowngrade, false);
        assert.equal(options.force, false);
        return { action: "install", apply: options.apply, target, backupPath: null, watchdog: null };
      },
      async confirmApply(question) {
        events.push(`confirm:${question.includes("Apply")}`);
        return true;
      },
      verifyInstalledRelease() {
        events.push("verify-installed");
        return { clean: true };
      },
      async reconcileStableAuthorityHost(options) {
        events.push("reconcile-authority");
        assert.deepEqual(options.expectedRelease, verifiedPayload("/tmp").release);
        assert.equal(options.scriptPath, join(target, "authority-host", "windows", "install-release.ps1"));
        assert.equal(options.installWhenDisabled, true);
        return { ...AUTHORITY_NOOP };
      },
    }),
  });

  assert.deepEqual(events, [
    "acquire",
    "install:false",
    "confirm:true",
    "install:true",
    "verify-installed",
    "reconcile-authority",
  ]);
  assert.equal(result.action, "install");
  assert.equal(result.apply, true);
  assert.equal(result.verified, true);
  assert.equal(result.authorityHost.action, "unsupported");
});

test("declining the shown dry-run cleans up and never calls installer apply or Authority reconciliation", async () => {
  const events = [];
  const target = resolve("/tmp/skills/github-delivery");
  const deps = dependencies({
    makeWorkspace() {
      events.push("workspace:create");
      return "/tmp/github-delivery-bootstrap-cancel";
    },
    removeWorkspace(workspace) {
      events.push(`workspace:remove:${workspace}`);
    },
    async acquireVerifiedReleasePayload({ workspace }) {
      events.push("acquire");
      return verifiedPayload(workspace);
    },
    installSkill(options) {
      events.push(`install:${options.apply}`);
      if (options.apply) throw new Error("apply must not run after cancellation");
      return { action: "install", apply: false, target, backupPath: null, watchdog: null };
    },
    async confirmApply() {
      events.push("confirm:no");
      return false;
    },
    readUserConfig() {
      throw new Error("cancelled install must not need config mutation checks");
    },
    verifyInstalledRelease() {
      throw new Error("cancelled install must not verify a non-existent install");
    },
    reconcileStableAuthorityHost() {
      throw new Error("cancelled install must not reconcile Authority");
    },
  });

  const result = await runGuidedInstall({ target, dependencies: deps });
  assert.deepEqual(result, {
    action: "cancelled",
    apply: false,
    installed: false,
    verified: true,
    sourceVersion: "0.5.0",
    target,
  });
  assert.deepEqual(events, [
    "workspace:create",
    "acquire",
    "install:false",
    "confirm:no",
    "workspace:remove:/tmp/github-delivery-bootstrap-cancel",
  ]);
});

test("accepted install requires post-install manifest verification, unchanged user config, and Authority reconciliation", async () => {
  let configReads = 0;
  let verified = 0;
  let authorityCalls = 0;
  const target = resolve("/tmp/skills/github-delivery");
  const result = await runGuidedInstall({
    target,
    dependencies: dependencies({
      readUserConfig() {
        configReads += 1;
        return { config: { schemaVersion: 1, authorityMode: "off" } };
      },
      installSkill(options) {
        return {
          action: "install",
          apply: options.apply,
          target,
          backupPath: options.apply ? "/tmp/backup" : null,
          watchdog: { mode: "hooks", hookTrustRequired: true },
        };
      },
      verifyInstalledRelease(options) {
        verified += 1;
        assert.equal(options.target, target);
        assert.equal(options.manifest.version, "0.5.0");
        return { clean: true };
      },
      async reconcileStableAuthorityHost() {
        authorityCalls += 1;
        return { ...AUTHORITY_NOOP };
      },
    }),
  });
  assert.equal(configReads, 2);
  assert.equal(verified, 1);
  assert.equal(authorityCalls, 1);
  assert.equal(result.backupPath, "/tmp/backup");
});

test("post-install config drift fails closed before Authority reconciliation and keeps backup path", async () => {
  let configReads = 0;
  let authorityCalls = 0;
  const target = resolve("/tmp/skills/github-delivery");
  await assert.rejects(
    runGuidedInstall({
      target,
      dependencies: dependencies({
        readUserConfig() {
          configReads += 1;
          return { config: { schemaVersion: 1, authorityMode: configReads > 1 ? "all" : "off" } };
        },
        installSkill(options) {
          return {
            action: "install",
            apply: options.apply,
            target,
            backupPath: options.apply ? "/tmp/backup" : null,
            watchdog: null,
          };
        },
        reconcileStableAuthorityHost() {
          authorityCalls += 1;
          return { ...AUTHORITY_NOOP };
        },
      }),
    }),
    (error) => {
      assert.match(error.message, /stable_install_user_config_changed_unexpectedly/);
      assert.equal(error.backupPath, "/tmp/backup");
      return true;
    },
  );
  assert.equal(authorityCalls, 0);
});

test("explicit install refuses to silently reinstall an already valid installation", async () => {
  const target = resolve("/tmp/skills/github-delivery");
  await assert.rejects(
    runGuidedInstall({
      target,
      dependencies: dependencies({
        discoverInstallations: () => [{ target, valid: true, version: "0.4.0", reason: null }],
      }),
    }),
    /bootstrap_install_existing/,
  );
});
