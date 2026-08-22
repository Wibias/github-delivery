import assert from "node:assert/strict";
import test from "node:test";

import { main } from "../../scripts/github-delivery-cli.mjs";
import { parseBootstrapArgs } from "../../scripts/lib/bootstrap-cli.mjs";
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

test("Authority start reuses an already-running host and asks it to show the Control Center", async () => {
  let spawnCalls = 0;
  let showCalls = 0;
  const exePath = "C:\\Users\\ws\\AppData\\Local\\GitHubDeliveryAuthority\\app\\v0.7.1\\GitHubDeliveryAuthority.exe";
  const result = await startInstalledAuthorityHost({
    platform: "win32",
    installed: { installed: true, version: "0.7.1", root: "C:\\Users\\ws\\AppData\\Local\\GitHubDeliveryAuthority", exePath },
    runner: () => { spawnCalls += 1; return { exitCode: null, unref() {} }; },
    probeStatus: () => ({ status: "ready" }),
    showControlCenter: () => { showCalls += 1; return { status: "shown" }; },
  });

  assert.equal(spawnCalls, 0);
  assert.equal(showCalls, 1);
  assert.equal(result.started, true);
  assert.equal(result.ready, true);
  assert.equal(result.shown, true);
  assert.equal(result.processStarted, false);
  assert.equal(result.exePath, exePath);
});

test("Authority start shows the Control Center after a freshly spawned host becomes ready", async () => {
  let probes = 0;
  let showCalls = 0;
  const child = { exitCode: null, unref() {} };
  const result = await startInstalledAuthorityHost({
    platform: "win32",
    installed: {
      installed: true,
      version: "0.7.1",
      root: "C:\\Users\\ws\\AppData\\Local\\GitHubDeliveryAuthority",
      exePath: "C:\\Users\\ws\\AppData\\Local\\GitHubDeliveryAuthority\\app\\v0.7.1\\GitHubDeliveryAuthority.exe",
    },
    runner: () => child,
    probeStatus: () => {
      probes += 1;
      if (probes < 2) throw new Error("authority_host_unavailable");
      return { status: "ready" };
    },
    showControlCenter: () => { showCalls += 1; return { status: "shown" }; },
    readinessTimeoutMs: 1_000,
    now: () => probes * 100,
    sleep: async () => {},
  });

  assert.equal(result.started, true);
  assert.equal(result.ready, true);
  assert.equal(result.shown, true);
  assert.equal(result.processStarted, true);
  assert.equal(showCalls, 1);
});

test("start success explains the notification-area lifecycle and executable location", async () => {
  const stdout = writableBuffer();
  const exePath = "C:\\Users\\ws\\AppData\\Local\\GitHubDeliveryAuthority\\app\\v0.7.1\\GitHubDeliveryAuthority.exe";
  await main(["start"], {
    stdout,
    runBootstrap: async () => ({ action: "start", started: true, ready: true, shown: true, exePath }),
  });

  const text = stdout.toString();
  assert.match(text, /Control Center.*open/i);
  assert.match(text, /GitHubDeliveryAuthority\.exe/);
  assert.match(text, /notification area/i);
  assert.match(text, /right-click/i);
  assert.match(text, /Exit/);
});

test("autostart parser supports backward-compatible on plus off and status modes", () => {
  assert.equal(parseBootstrapArgs(["autostart"]).autostartMode, "on");
  assert.equal(parseBootstrapArgs(["autostart", "on"]).autostartMode, "on");
  assert.equal(parseBootstrapArgs(["autostart", "off"]).autostartMode, "off");
  assert.equal(parseBootstrapArgs(["autostart", "status"]).autostartMode, "status");
  assert.throws(() => parseBootstrapArgs(["autostart", "maybe"]), /bootstrap_autostart_mode_invalid/);
});

test("autostart renderer distinguishes enabled disabled and status without raw receipts", async () => {
  for (const [argv, result, pattern] of [
    [["autostart", "on"], { action: "autostart", mode: "on", enabled: true, configured: true, changed: true }, /auto-start is enabled/i],
    [["autostart", "off"], { action: "autostart", mode: "off", enabled: false, configured: false, changed: true }, /auto-start is disabled/i],
    [["autostart", "status"], { action: "autostart", mode: "status", enabled: false, configured: false, changed: false }, /auto-start is disabled/i],
  ]) {
    const stdout = writableBuffer();
    await main(argv, { stdout, runBootstrap: async () => result });
    assert.match(stdout.toString(), pattern);
    assert.doesNotMatch(stdout.toString(), /^\s*\{/);
  }
});

test("Authority startup state helper supports read enable disable and unchanged state", async () => {
  const install = await import("../../scripts/lib/authority-host-install.mjs");
  assert.equal(typeof install.readAuthorityHostStartup, "function");
  assert.equal(typeof install.setAuthorityHostStartup, "function");

  const exePath = "C:\\Users\\ws\\AppData\\Local\\GitHubDeliveryAuthority\\app\\v0.7.1\\GitHubDeliveryAuthority.exe";
  let registered = null;
  const runner = (_program, args) => {
    if (args[0] === "QUERY") {
      return registered === null
        ? { status: 1, stdout: "", stderr: "ERROR: The system was unable to find the specified registry value." }
        : { status: 0, stdout: `GitHubDeliveryAuthority    REG_SZ    ${registered}\r\n`, stderr: "" };
    }
    if (args[0] === "ADD") {
      registered = args[args.indexOf("/d") + 1];
      return { status: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "DELETE") {
      registered = null;
      return { status: 0, stdout: "", stderr: "" };
    }
    throw new Error(`unexpected reg command: ${args.join(" ")}`);
  };
  const installed = { installed: true, exePath };
  const exists = () => false;

  assert.equal(install.readAuthorityHostStartup({ platform: "win32", installed, runner, exists }).enabled, false);
  assert.deepEqual(
    install.setAuthorityHostStartup({ platform: "win32", installed, runner, exists, enabled: true }),
    { configured: true, enabled: true, changed: true, exePath },
  );
  assert.equal(install.readAuthorityHostStartup({ platform: "win32", installed, runner, exists }).enabled, true);
  assert.equal(install.setAuthorityHostStartup({ platform: "win32", installed, runner, exists, enabled: true }).changed, false);
  assert.deepEqual(
    install.setAuthorityHostStartup({ platform: "win32", installed, runner, exists, enabled: false }),
    { configured: false, enabled: false, changed: true, exePath },
  );
  assert.equal(install.readAuthorityHostStartup({ platform: "win32", installed, runner, exists }).enabled, false);
});

test("autostart status and off include the Startup folder shortcut", async () => {
  const install = await import("../../scripts/lib/authority-host-install.mjs");
  const exePath = "C:\\Users\\me\\AppData\\Local\\GitHubDeliveryAuthority\\app\\v0.7.1\\GitHubDeliveryAuthority.exe";
  const shortcut = "C:\\Users\\me\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\GitHub Delivery Authority.lnk";
  let shortcutExists = true;
  const removed = [];
  const runner = () => ({ status: 1, stdout: "", stderr: "not found" });
  const installed = { installed: true, exePath };
  const env = { APPDATA: "C:\\Users\\me\\AppData\\Roaming" };
  const exists = (path) => path === shortcut && shortcutExists;
  const remove = (path) => {
    removed.push(path);
    shortcutExists = false;
  };

  const status = install.readAuthorityHostStartup({
    platform: "win32",
    installed,
    runner,
    env,
    exists,
  });
  assert.equal(status.enabled, true);

  const off = install.setAuthorityHostStartup({
    enabled: false,
    platform: "win32",
    installed,
    runner,
    env,
    exists,
    remove,
  });
  assert.equal(off.enabled, false);
  assert.equal(off.changed, true);
  assert.deepEqual(removed, [shortcut]);
});
