import assert from "node:assert/strict";
import test from "node:test";

import { waitForObservedHead } from "../../scripts/lib/live-fixture-head.mjs";

test("retries until the expected PR head is observable", async () => {
  const observed = ["old-head", "old-head", "new-head"];
  let now = 0;
  let reads = 0;

  const result = await waitForObservedHead({
    readHead: async () => {
      reads += 1;
      return observed.shift();
    },
    expectedHead: "new-head",
    timeoutMs: 100,
    intervalMs: 10,
    now: () => now,
    sleep: async (ms) => { now += ms; },
  });

  assert.equal(result, "new-head");
  assert.equal(reads, 3);
  assert.equal(now, 20);
});

test("returns before stale-head mutation work can continue", async () => {
  const calls = [];
  let now = 0;
  const heads = ["snapshot-head", "advanced-head"];

  await waitForObservedHead({
    readHead: async () => {
      calls.push("read-head");
      return heads.shift();
    },
    expectedHead: "advanced-head",
    timeoutMs: 100,
    intervalMs: 10,
    now: () => now,
    sleep: async (ms) => {
      calls.push("sleep");
      now += ms;
    },
  });
  calls.push("attempt-stale-mutation");

  assert.deepEqual(calls, ["read-head", "sleep", "read-head", "attempt-stale-mutation"]);
});

test("times out fail-closed with expected and observed heads", async () => {
  let now = 0;

  await assert.rejects(
    waitForObservedHead({
      readHead: async () => "old-head",
      expectedHead: "new-head",
      timeoutMs: 20,
      intervalMs: 10,
      now: () => now,
      sleep: async (ms) => { now += ms; },
    }),
    (error) => {
      assert.equal(error.code, "fixture_head_propagation_timeout");
      assert.equal(error.expectedHead, "new-head");
      assert.equal(error.observedHead, "old-head");
      assert.match(error.message, /expected new-head, observed old-head/);
      return true;
    },
  );
});
