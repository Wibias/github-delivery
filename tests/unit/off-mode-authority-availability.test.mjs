import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { runBootstrapSetup } from "../../scripts/lib/bootstrap-maintenance.mjs";

test("setup opts into Authority provisioning even when protection mode is Off", async () => {
  const target = resolve("test-fixtures/off-mode-setup");
  let reconcileOptions = null;

  const result = await runBootstrapSetup({
    target,
    output: { write() {} },
    dependencies: {
      discoverInstallations: () => [{ valid: true, target }],
      reconcileStableAuthorityHost: async (options) => {
        reconcileOptions = options;
        return {
          action: "install",
          changed: false,
          installed: { installed: false },
        };
      },
      startInstalledAuthorityHost: async () => ({
        started: false,
        reason: "not_installed",
      }),
      readActivationReceipt: () => ({
        mode: "hooks",
        hookTrustVerified: true,
      }),
    },
  });

  assert.equal(result.status, "ready");
  assert.equal(reconcileOptions?.installWhenDisabled, true);
});
