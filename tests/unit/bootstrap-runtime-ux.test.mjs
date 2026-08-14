import assert from "node:assert/strict";
import test from "node:test";

import { main } from "../../scripts/github-delivery-cli.mjs";
import { startInstalledAuthorityHost } from "../../scripts/lib/authority-host-install.mjs";

function writableBuffer() {
  let text = "";
  return {
    write(chunk) { text += String(chunk); },
    toString() { return text; },
  };
}

function updateResult(overrides = {}) {
  return {
    action: "migrate_legacy",
    apply: true,
    updated: true,
    verified: true,
    previousVersion: "0.6.1",
    sourceVersion: "0.7.0",
    target: "C:\\Users\\ws\\.agents\\skills\\github-delivery",
    backupPath: "C:\\Users\\ws\\.agents\\skills\\.github-delivery-backups\\backup-0.6.1",
    release: { tag: "v0.7.0", version: "0.7.0", sourceCommit: "a".repeat(40) },
    authorityHost: {
      action: "update",
      changed: true,
      currentVersion: "0.6.0",
      targetVersion: "0.7.0",
      installed: { version: "0.7.0" },
    },
    ...overrides,
  };
}

test("update renders a concise human summary instead of the internal receipt", async () => {
  const stdout = writableBuffer();
  await main(["update", "--apply"], {
    stdout,
    runBootstrap: async () => updateResult(),
  });

  const text = stdout.toString();
  assert.match(text, /GitHub Delivery updated/i);
  assert.match(text, /0\.6\.1\s+.*0\.7\.0/);
  assert.match(text, /Authority GUI/i);
  assert.match(text, /0\.6\.0\s+.*0\.7\.0/);
  assert.doesNotMatch(text, /^\s*\{/);
  assert.doesNotMatch(text, /"schemaVersion"|"authorityHost"/);
});

test("update dry-run renders a plan and preserves explicit apply guidance", async () => {
  const stdout = writableBuffer();
  await main(["update"], {
    stdout,
    runBootstrap: async () => updateResult({
      apply: false,
      updated: false,
      currentVersion: "0.6.1",
      sourceVersion: undefined,
      previousVersion: undefined,
      legacyManifestless: true,
      migrationAllowed: true,
    }),
  });

  const text = stdout.toString();
  assert.match(text, /update plan/i);
  assert.match(text, /0\.6\.1/);
  assert.match(text, /0\.7\.0/);
  assert.match(text, /update --apply/i);
  assert.doesNotMatch(text, /^\s*\{/);
});

test("autostart routes through the human renderer", async () => {
  const stdout = writableBuffer();
  await main(["autostart"], {
    stdout,
    runBootstrap: async () => ({
      action: "autostart",
      configured: true,
      changed: true,
      exePath: "C:\\Users\\ws\\AppData\\Local\\GitHubDeliveryAuthority\\app\\v0.7.0\\GitHubDeliveryAuthority.exe",
    }),
  });

  const text = stdout.toString();
  assert.match(text, /auto-start is enabled/i);
  assert.doesNotMatch(text, /^\s*\{/);
});

test("update apply exposes live progress to the bootstrap workflow before final rendering", async () => {
  const stdout = writableBuffer();
  let progressType = null;
  await main(["update", "--apply"], {
    stdout,
    runBootstrap: async (_argv, dependencies) => {
      progressType = typeof dependencies.onProgress;
      dependencies.onProgress({ stage: "checking_release" });
      dependencies.onProgress({ stage: "release_verified", version: "0.7.0" });
      return updateResult();
    },
  });

  assert.equal(progressType, "function");
  const text = stdout.toString();
  assert.match(text, /Checking latest stable release/i);
  assert.match(text, /Verified release v0\.7\.0/i);
  assert.ok(text.indexOf("Checking latest stable release") < text.indexOf("GitHub Delivery updated"));
});

test("Authority start fails closed when spawn succeeds but readiness never arrives", async () => {
  let unrefCalls = 0;
  let now = 0;
  const child = { exitCode: null, unref() { unrefCalls += 1; } };
  const result = await startInstalledAuthorityHost({
    platform: "win32",
    installed: {
      installed: true,
      version: "0.7.0",
      root: "C:\\Users\\ws\\AppData\\Local\\GitHubDeliveryAuthority",
      exePath: "C:\\Users\\ws\\AppData\\Local\\GitHubDeliveryAuthority\\app\\v0.7.0\\GitHubDeliveryAuthority.exe",
    },
    runner: () => child,
    probeStatus: () => { throw new Error("authority_host_unavailable"); },
    readinessTimeoutMs: 100,
    now: () => { now += 60; return now; },
    sleep: async () => {},
  });

  assert.equal(result.started, false);
  assert.equal(result.ready, false);
  assert.equal(result.reason, "readiness_timeout");
  assert.match(result.diagnosticsPath, /GitHubDeliveryAuthority[\\/]startup-error\.log$/);
  assert.equal(unrefCalls, 1);
});

test("Authority start reports success only after the status pipe is ready", async () => {
  let probes = 0;
  const child = { exitCode: null, unref() {} };
  const result = await startInstalledAuthorityHost({
    platform: "win32",
    installed: {
      installed: true,
      version: "0.7.0",
      root: "C:\\Users\\ws\\AppData\\Local\\GitHubDeliveryAuthority",
      exePath: "C:\\Users\\ws\\AppData\\Local\\GitHubDeliveryAuthority\\app\\v0.7.0\\GitHubDeliveryAuthority.exe",
    },
    runner: () => child,
    probeStatus: () => {
      probes += 1;
      if (probes === 1) throw new Error("authority_host_unavailable");
      return { status: "ready" };
    },
    readinessTimeoutMs: 1_000,
    now: () => probes * 100,
    sleep: async () => {},
  });

  assert.equal(result.started, true);
  assert.equal(result.ready, true);
  assert.equal(result.version, "0.7.0");
  assert.equal(probes, 2);
});
