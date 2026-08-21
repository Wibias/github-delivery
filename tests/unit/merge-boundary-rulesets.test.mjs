import assert from "node:assert/strict";
import test from "node:test";

import { mergeBoundaryForSnapshot } from "../../scripts/lib/merge-boundary.mjs";

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const RULES = "c".repeat(64);

function snapshot(activeRules) {
  return {
    headOid: HEAD,
    evidence: {
      captureBoundary: {
        headOid: HEAD,
        baseRefName: "main",
        baseOid: BASE,
        rulesFingerprint: RULES,
      },
      pullRequest: { stack: null },
      activeRules,
      policy: { mergeQueue: { enabled: false } },
    },
  };
}

const loose = {
  type: "required_status_checks",
  parameters: { strict_required_status_checks_policy: false },
};
const strict = {
  type: "required_status_checks",
  parameters: { strict_required_status_checks_policy: true },
};

test("strict required checks win when a loose ruleset appears first", () => {
  const boundary = mergeBoundaryForSnapshot(snapshot([loose, strict]));
  assert.equal(boundary.coherence, "strict_required_checks");
});

test("strict required checks are independent of ruleset order", () => {
  const first = mergeBoundaryForSnapshot(snapshot([loose, strict]));
  const second = mergeBoundaryForSnapshot(snapshot([strict, loose]));
  assert.deepEqual(first, second);
});

test("all-loose rules still fail without merge queue enforcement", () => {
  assert.throws(
    () => mergeBoundaryForSnapshot(snapshot([loose, structuredClone(loose)])),
    /merge_boundary_not_server_enforced/,
  );
});
