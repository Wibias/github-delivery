import assert from "node:assert/strict";
import test from "node:test";

import {
  planAuthorityHostUpdate,
  readInstalledAuthorityHost,
  reconcileStableAuthorityHost,
} from "../../scripts/lib/authority-host-install.mjs";

const winEnv = { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" };

function installed(overrides = {}) {
  return {
    supported: true,
    installed: true,
    legacy: false,
    version: "0.5.1",
    sourceCommit: "a".repeat(40),
    ...overrides,
  };
}

test("authority host planning preserves off semantics but upgrades existing legacy hosts", () => {
  assert.deepEqual(
    planAuthorityHostUpdate({
      mode: "off",
      targetVersion: "0.5.2",
      installed: { supported: true, installed: false, legacy: false, version: null },
    }),
    { action: "disabled", required: false, currentVersion: null, targetVersion: "0.5.2" },
  );
  assert.equal(
    planAuthorityHostUpdate({
      mode: "off",
      targetVersion: "0.5.2",
      installed: installed({ legacy: true, version: null }),
    }).action,
    "upgrade_legacy",
  );
  assert.equal(
    planAuthorityHostUpdate({
      mode: "high-assurance",
      targetVersion: "0.5.2",
      installed: { supported: true, installed: false, legacy: false, version: null },
    }).action,
    "install",
  );
});

test("authority host planning never downgrades an ahead install", () => {
  const plan = planAuthorityHostUpdate({
    mode: "all",
    targetVersion: "0.5.2",
    installed: installed({ version: "0.6.0" }),
  });
  assert.equal(plan.action, "already_ahead");
  assert.equal(plan.required, false);
});

test("installed authority host detection distinguishes versioned and legacy layouts", () => {
  const versionedRecord = JSON.stringify({
    schemaVersion: 1,
    kind: "github-delivery/authority-host-install",
    version: "0.5.2",
    sourceCommit: "b".repeat(40),
    appDir: "app/v0.5.2",
    installedAt: "2026-08-12T00:00:00Z",
  });
  const recordPath = "C:\\Users\\me\\AppData\\Local\\GitHubDeliveryAuthority\\authority-host-install.json";
  const exePath = "C:\\Users\\me\\AppData\\Local\\GitHubDeliveryAuthority\\app\\v0.5.2\\GitHubDeliveryAuthority.exe";
  const versioned = readInstalledAuthorityHost({
    platform: "win32",
    env: winEnv,
    home: "C:\\Users\\me",
    exists: (path) => path === recordPath || path === exePath,
    readFile: () => versionedRecord,
  });
  assert.equal(versioned.installed, true);
  assert.equal(versioned.legacy, false);
  assert.equal(versioned.version, "0.5.2");
  assert.equal(versioned.sourceCommit, "b".repeat(40));

  const legacyExe = "C:\\Users\\me\\AppData\\Local\\GitHubDeliveryAuthority\\GitHubDeliveryAuthority.exe";
  const legacy = readInstalledAuthorityHost({
    platform: "win32",
    env: winEnv,
    home: "C:\\Users\\me",
    exists: (path) => path === legacyExe,
    readFile: () => { throw new Error("not used"); },
  });
  assert.equal(legacy.installed, true);
  assert.equal(legacy.legacy, true);
  assert.equal(legacy.version, null);
});

test("unsupported systems report when the configured mode requires Authority", async () => {
  const result = await reconcileStableAuthorityHost({
    platform: "linux",
    dependencies: {
      readInstalledAuthorityHost: () => ({
        supported: false,
        configured: false,
        installed: false,
        legacy: false,
        version: null,
        sourceCommit: null,
      }),
      readUserConfig: () => ({
        source: "file",
        config: { schemaVersion: 1, authorityMode: "high-assurance" },
      }),
    },
    client: {
      latestRelease() { throw new Error("unsupported host must not fetch release assets"); },
      resolveTagCommit() { throw new Error("unsupported host must not resolve tags"); },
    },
  });

  assert.deepEqual(result, {
    action: "unsupported",
    required: true,
    changed: false,
    installed: {
      supported: false,
      configured: false,
      installed: false,
      legacy: false,
      version: null,
      sourceCommit: null,
    },
    mode: "high-assurance",
  });
});

test("explicit install opt-in overrides disabled planning without changing authority mode", async () => {
  let isInstalled = false;
  let installCalls = 0;
  const expectedRelease = { tag: "v0.5.2", version: "0.5.2", sourceCommit: "b".repeat(40) };
  const result = await reconcileStableAuthorityHost({
    expectedRelease,
    platform: "win32",
    installWhenDisabled: true,
    client: {
      async latestRelease() { return { tag_name: expectedRelease.tag }; },
    },
    dependencies: {
      readUserConfig: () => ({ config: { schemaVersion: 1, authorityMode: "off" } }),
      readInstalledAuthorityHost: () => isInstalled
        ? installed({ version: expectedRelease.version, sourceCommit: expectedRelease.sourceCommit })
        : { supported: true, configured: false, installed: false, legacy: false, version: null, sourceCommit: null },
      makeWorkspace: () => "/tmp/authority-host-opt-in",
      removeWorkspace() {},
      acquireVerifiedAuthorityHostPayload: async () => ({ verified: true }),
      installVerifiedAuthorityHost() {
        installCalls += 1;
        isInstalled = true;
        return { status: 0 };
      },
    },
  });

  assert.equal(installCalls, 1);
  assert.equal(result.action, "install");
  assert.equal(result.mode, "off");
});
