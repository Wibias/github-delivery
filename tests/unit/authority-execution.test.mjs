import assert from "node:assert/strict";
import test from "node:test";

import { makeRedemptionRunner } from "../../scripts/lib/authority-execution.mjs";

const plannedCommand = ["gh", "pr", "merge", "32", "--repo", "acme/widgets", "--merge"];
const authority = {
  verified: true,
  claims: {
    redemption: "required",
    scopeSha256: "a".repeat(64),
    nonce: "gnt_test",
  },
};

test("preflight reads do not redeem and the exact mutation redeems before spawn", () => {
  const events = [];
  const execution = makeRedemptionRunner({
    plannedCommand,
    authority,
    authorityGrant: "gd1.payload.signature",
    redeemer() {
      events.push("redeem");
      return { status: "consumed", nonce: "gnt_test", consumedAt: 123 };
    },
    runner(command, args) {
      events.push(`spawn:${command} ${args.join(" ")}`);
      return { status: 0, stdout: "", stderr: "" };
    },
  });

  execution.runner("gh", ["pr", "view", "32"]);
  assert.deepEqual(events, ["spawn:gh pr view 32"]);

  execution.runner(plannedCommand[0], plannedCommand.slice(1));
  assert.deepEqual(events.slice(-2), ["redeem", `spawn:${plannedCommand.join(" ")}`]);
  assert.deepEqual(execution.redemption(), {
    status: "consumed",
    nonce: "gnt_test",
    consumedAt: 123,
  });

  execution.runner(plannedCommand[0], plannedCommand.slice(1));
  assert.equal(events.filter((event) => event === "redeem").length, 1);
});

test("failed redemption prevents the GitHub mutation process from spawning", () => {
  let spawned = false;
  const execution = makeRedemptionRunner({
    plannedCommand,
    authority,
    authorityGrant: "gd1.payload.signature",
    redeemer() {
      throw new Error("already consumed");
    },
    runner() {
      spawned = true;
      return { status: 0, stdout: "", stderr: "" };
    },
  });

  assert.throws(
    () => execution.runner(plannedCommand[0], plannedCommand.slice(1)),
    /already consumed/,
  );
  assert.equal(spawned, false);
});
