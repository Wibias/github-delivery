import assert from "node:assert/strict";
import test from "node:test";

import { captureLiveSnapshot } from "../../scripts/lib/live-snapshot.mjs";

test("live snapshot preserves a structured child failure cause", () => {
  const runner = () => ({
    status: 2,
    stdout: `${JSON.stringify({
      schemaVersion: 1,
      kind: "github-delivery/ship-gate-snapshot-error",
      code: "snapshot_rules_boundary_incomplete",
      message: "snapshot_rules_boundary_incomplete",
      causeMessage: "HTTP 403: Upgrade to GitHub Pro to use repository rules",
    })}\n`,
    stderr: "",
  });

  assert.throws(
    () => captureLiveSnapshot({ repo: "acme/widgets", pr: 7, runner }),
    (error) => {
      assert.equal(error.code, "snapshot_rules_boundary_incomplete");
      assert.equal(
        error.causeMessage,
        "HTTP 403: Upgrade to GitHub Pro to use repository rules",
      );
      return true;
    },
  );
});
