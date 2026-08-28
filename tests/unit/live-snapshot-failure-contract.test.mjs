import assert from "node:assert/strict";
import test from "node:test";

import { captureLiveSnapshot } from "../../scripts/lib/live-snapshot.mjs";

test("live snapshot preserves a rules capability failure from the capture subprocess", () => {
  const runner = () => ({
    status: 2,
    stdout: "",
    stderr:
      "snapshot_rules_boundary_incomplete: HTTP 403: Upgrade to GitHub Pro to use repository rules\n",
  });

  assert.throws(
    () => captureLiveSnapshot({ repo: "acme/widgets", pr: 7, runner }),
    /snapshot_rules_boundary_incomplete.*403.*GitHub Pro/i,
  );
});
