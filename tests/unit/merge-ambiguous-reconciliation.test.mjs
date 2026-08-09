import assert from "node:assert/strict";
import test from "node:test";

import { makeRedemptionRunner } from "../../scripts/lib/authority-execution.mjs";
import { reconcileAttemptedMerge } from "../../scripts/lib/mutation-execution-context.mjs";

const HEAD = "a".repeat(40);

function plannedMerge() {
  return {
    schemaVersion: 1,
    kind: "github-delivery/mutation-plan",
    action: "merge_pr",
    repo: "acme/widgets",
    pr: 32,
    expectedHead: HEAD,
    request: {
      schemaVersion: 1,
      action: "merge_pr",
      mutationMode: "maintainer",
      explicitInstruction: true,
      repo: "acme/widgets",
      pr: 32,
      expectedHead: HEAD,
      mergeMethod: "merge",
    },
    command: ["gh", "pr", "merge", "32"],
  };
}

test("reconciles a merge that reached GitHub before the command reported failure", () => {
  const result = reconcileAttemptedMerge({
    planned: plannedMerge(),
    runner(command, args) {
      assert.equal(command, "gh");
      assert.equal(args[0], "api");
      assert.equal(args[1], "graphql");
      return {
        status: 0,
        stdout: JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                state: "MERGED",
                mergedAt: "2026-08-09T21:00:00Z",
                headRefOid: HEAD,
                isInMergeQueue: false,
                mergeQueueEntry: null,
                autoMergeRequest: null,
              },
            },
          },
        }),
        stderr: "",
      };
    },
  });
  assert.equal(result.status, "reconciled_after_error");
  assert.equal(result.outcome, "merged");
  assert.equal(result.executed, true);
  assert.equal(result.verification.headRefOid, HEAD);
});

test("write attempt is recorded only after authority redemption succeeds", () => {
  let underlyingCalls = 0;
  const execution = makeRedemptionRunner({
    plannedCommand: ["gh", "pr", "merge", "32"],
    authority: {
      verified: true,
      claims: { redemption: "required", scopeSha256: "b".repeat(64) },
    },
    authorityGrant: "gd1.fake.fake",
    redeemer() {
      throw new Error("redemption denied");
    },
    runner() {
      underlyingCalls += 1;
      return { status: 1, stdout: "", stderr: "transport failed" };
    },
  });

  assert.throws(
    () => execution.runner("gh", ["pr", "merge", "32"], {}),
    /redemption denied/,
  );
  assert.equal(execution.attempted(), false);
  assert.equal(underlyingCalls, 0);
});
