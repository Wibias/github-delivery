import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { runBootstrapSetup } from "../../scripts/lib/bootstrap-maintenance.mjs";

const TARGET = resolve("/tmp/github-delivery-authority-portability");
const CODEX_HOME = resolve("/tmp/github-delivery-authority-portability-codex");

test("setup remains usable when secure authority is required but bundled host is unsupported", async () => {
  const output = [];
  const authorityHost = {
    action: "unsupported",
    required: true,
    changed: false,
    mode: "high-assurance",
    installed: { supported: false, installed: false },
  };
  const result = await runBootstrapSetup({
    target: TARGET,
    codexHome: CODEX_HOME,
    output: { write(value) { output.push(String(value)); } },
    dependencies: {
      discoverInstallations: () => [{ target: TARGET, valid: true, version: "0.7.3" }],
      reconcileStableAuthorityHost: async () => authorityHost,
      readActivationReceipt: () => ({
        schemaVersion: 1,
        mode: "hooks",
        hooksConfigured: true,
        hookTrustVerified: true,
      }),
    },
  });

  assert.equal(result.status, "authority_provider_required");
  assert.equal(result.watchdog, "hooks");
  assert.equal(result.changed, false);
  assert.deepEqual(result.authorityHost, authorityHost);
  assert.match(result.guidance, /Protected GitHub writes stay blocked/);
  assert.match(output.join(""), /unsupported_platform/);
  assert.match(output.join(""), /authorityMode=off/);
});
