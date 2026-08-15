import assert from "node:assert/strict";
import test from "node:test";

import { runBootstrapAutostart, runBootstrapStart } from "../../scripts/lib/bootstrap-maintenance.mjs";

test("bootstrap start preserves visible Control Center result fields", async () => {
  const exePath = "C:\\Users\\ws\\AppData\\Local\\GitHubDeliveryAuthority\\GitHubDeliveryAuthority.exe";
  const result = await runBootstrapStart({
    dependencies: {
      startInstalledAuthorityHost: async () => ({
        started: true,
        ready: true,
        shown: true,
        processStarted: false,
        exePath,
      }),
    },
  });

  assert.deepEqual(result, {
    action: "start",
    started: true,
    ready: true,
    shown: true,
    processStarted: false,
    exePath,
  });
});

test("bootstrap autostart status is read-only and on/off use the shared setter", () => {
  let reads = 0;
  const writes = [];
  const dependencies = {
    readAuthorityHostStartup: () => {
      reads += 1;
      return { enabled: true, configured: true, changed: false };
    },
    setAuthorityHostStartup: ({ enabled }) => {
      writes.push(enabled);
      return { enabled, configured: enabled, changed: true };
    },
  };

  assert.deepEqual(runBootstrapAutostart({ mode: "status", dependencies }), {
    action: "autostart",
    mode: "status",
    enabled: true,
    configured: true,
    changed: false,
  });
  assert.deepEqual(runBootstrapAutostart({ mode: "on", dependencies }), {
    action: "autostart",
    mode: "on",
    enabled: true,
    configured: true,
    changed: true,
  });
  assert.deepEqual(runBootstrapAutostart({ mode: "off", dependencies }), {
    action: "autostart",
    mode: "off",
    enabled: false,
    configured: false,
    changed: true,
  });

  assert.equal(reads, 1);
  assert.deepEqual(writes, [true, false]);
});
