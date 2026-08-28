import assert from "node:assert/strict";
import test from "node:test";

import { verifySnapshotBoundary } from "../../scripts/lib/snapshot-capture-payload.mjs";

test("snapshot boundary preserves the cause of incomplete rules evidence", () => {
  let observed = null;
  try {
    verifySnapshotBoundary(
      { headRefOid: "head-a", baseRefName: "main" },
      { headRefOid: "head-a", baseRefName: "main" },
      {
        initialBaseOid: "base-a",
        finalBaseOid: "base-a",
        initialRules: {
          readable: false,
          complete: false,
          pages: 0,
          rows: [],
          error: "HTTP 403: Upgrade to GitHub Pro to use repository rules",
        },
        finalRules: {
          readable: false,
          complete: false,
          pages: 0,
          rows: [],
          error: "HTTP 403: Upgrade to GitHub Pro to use repository rules",
        },
      },
    );
  } catch (error) {
    observed = error;
  }

  assert.ok(observed instanceof Error);
  assert.equal(observed.code, "snapshot_rules_boundary_incomplete");
  assert.equal(
    observed.causeMessage,
    "HTTP 403: Upgrade to GitHub Pro to use repository rules",
  );
  assert.match(observed.message, /snapshot_rules_boundary_incomplete.*403.*GitHub Pro/i);
});
