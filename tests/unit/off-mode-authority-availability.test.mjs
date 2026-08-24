import assert from "node:assert/strict";
import test from "node:test";

import { planAuthorityHostUpdate } from "../../scripts/lib/authority-host-install.mjs";

test("Off mode still provisions the Windows authority host for independently authenticated intent", () => {
  assert.deepEqual(
    planAuthorityHostUpdate({
      mode: "off",
      targetVersion: "0.5.2",
      installed: {
        supported: true,
        configured: false,
        installed: false,
        legacy: false,
        version: null,
      },
    }),
    {
      action: "install",
      required: true,
      currentVersion: null,
      targetVersion: "0.5.2",
    },
  );
});
