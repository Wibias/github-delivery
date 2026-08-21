import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  nativeStackBlocksDirectMerge,
  nativeStackFromSnapshot,
  nativeStackUnknowns,
  normalizeNativeStack,
  protectionRefName,
} from "../../scripts/lib/native-stack-policy.mjs";

test("null stack is not a native stack", () => {
  assert.deepEqual(normalizeNativeStack(null), {
    present: false,
    complete: true,
    baseRefName: null,
    size: null,
  });
});

test("GraphQL stack identity uses baseRefName and size", () => {
  assert.deepEqual(
    normalizeNativeStack({ size: 5, baseRefName: "main" }),
    {
      present: true,
      complete: true,
      baseRefName: "main",
      size: 5,
    },
  );
});

test("REST stack identity uses base.ref and size", () => {
  assert.deepEqual(
    normalizeNativeStack({ size: 2, base: { ref: "main", sha: "abc" } }),
    {
      present: true,
      complete: true,
      baseRefName: "main",
      size: 2,
    },
  );
});

test("a stack object without size or base is unreadable", () => {
  const identity = normalizeNativeStack({});
  assert.equal(identity.present, true);
  assert.equal(identity.complete, false);
});

test("protection ref is the stack base when native stack identity is complete", () => {
  const snapshot = {
    evidence: {
      pullRequest: {
        baseRefName: "feat/p1-visual-evidence",
        stack: { size: 5, baseRefName: "main" },
      },
    },
  };
  assert.equal(protectionRefName(snapshot), "main");
  assert.equal(nativeStackFromSnapshot(snapshot).size, 5);
});

test("protection ref stays the PR base when the PR is not a native stack", () => {
  const snapshot = {
    evidence: { pullRequest: { baseRefName: "feat/p1-visual-evidence" } },
  };
  assert.equal(protectionRefName(snapshot), "feat/p1-visual-evidence");
});

test("remaining native-stack layers are unknown", () => {
  const snapshot = {
    evidence: {
      pullRequest: {
        baseRefName: "feat/p1-visual-evidence",
        stack: { size: 5, baseRefName: "main" },
      },
    },
  };
  assert.deepEqual(nativeStackUnknowns(snapshot, { mode: "configured" }), [
    "policy:native_stack_remaining_layers_unevaluated",
  ]);
});

test("observed required checks cannot ready a native-stack member", () => {
  const snapshot = {
    evidence: {
      pullRequest: {
        baseRefName: "feat/p1-visual-evidence",
        stack: { size: 1, baseRefName: "main" },
      },
    },
  };
  assert.ok(
    nativeStackUnknowns(snapshot, { mode: "observed" }).includes(
      "policy:native_stack_observed_checks",
    ),
  );
});

test("direct merge is forbidden while native stack identity is present", () => {
  const snapshot = {
    evidence: {
      pullRequest: { stack: { size: 1, baseRefName: "main" } },
    },
  };
  assert.equal(nativeStackBlocksDirectMerge(snapshot), true);
  assert.equal(
    nativeStackBlocksDirectMerge({ evidence: { pullRequest: {} } }),
    false,
  );
});

test("snapshot capture binds rules, CODEOWNERS, and classic protection to the protection ref", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../../scripts/ship-gate-snapshot.mjs", import.meta.url)),
    "utf8",
  );
  assert.match(source, /protectionBase/);
  assert.match(source, /rules\/branches\/\$\{encodeURIComponent\(protectionBase\)\}/);
});
