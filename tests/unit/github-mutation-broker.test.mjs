import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  executeMutationRequest,
  planMutationRequest,
} from "../../scripts/lib/github-mutation-broker.mjs";

function mergeRequest(overrides = {}) {
  return {
    schemaVersion: 1,
    action: "merge_pr",
    mutationMode: "maintainer",
    explicitInstruction: true,
    repo: "acme/widgets",
    pr: 32,
    expectedHead: "abcdef1234567890",
    mergeMethod: "merge",
    ...overrides,
  };
}

test("denies a mutation before spawning any process", () => {
  let calls = 0;
  assert.throws(
    () =>
      executeMutationRequest({
        request: mergeRequest({ mutationMode: "review" }),
        execute: true,
        runner() {
          calls += 1;
          return { status: 0, stdout: "", stderr: "" };
        },
      }),
    /mutation_denied:mode_denied/,
  );
  assert.equal(calls, 0);
});

test("plans a head-pinned merge without executing it", () => {
  const result = executeMutationRequest({ request: mergeRequest() });
  assert.equal(result.executed, false);
  assert.equal(result.status, "dry_run");
  assert.deepEqual(result.command.slice(0, 6), [
    "gh",
    "pr",
    "merge",
    "32",
    "--repo",
    "acme/widgets",
  ]);
  assert.ok(result.command.includes("--match-head-commit"));
  assert.equal(result.expectedHead, "abcdef1234567890");
});

test("checks the current PR head before a write", () => {
  const calls = [];
  const result = executeMutationRequest({
    request: mergeRequest(),
    execute: true,
    runner(command, args) {
      calls.push([command, ...args]);
      if (args[0] === "pr" && args[1] === "view") {
        return { status: 0, stdout: "abcdef1234567890\n", stderr: "" };
      }
      if (args[0] === "pr" && args[1] === "merge") {
        return { status: 0, stdout: "merged\n", stderr: "" };
      }
      return {
        status: 0,
        stdout: JSON.stringify({ state: "MERGED", mergedAt: "2026-08-01T00:00:00Z" }),
        stderr: "",
      };
    },
  });
  assert.equal(result.executed, true);
  assert.equal(result.status, "succeeded");
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].slice(0, 4), ["gh", "pr", "view", "32"]);
});

test("fails closed when the PR head moved", () => {
  let calls = 0;
  assert.throws(
    () =>
      executeMutationRequest({
        request: mergeRequest(),
        execute: true,
        runner() {
          calls += 1;
          return { status: 0, stdout: "different-head\n", stderr: "" };
        },
      }),
    /expected_head_mismatch/,
  );
  assert.equal(calls, 1);
});

test("requires the hash of the exact approved human reply", () => {
  const body = "Thanks, this is fixed in abc1234.";
  const exactTextSha256 = createHash("sha256").update(body).digest("hex");
  const plan = planMutationRequest({
    schemaVersion: 1,
    action: "reply_human_thread",
    mutationMode: "review",
    exactTextConfirmed: true,
    exactTextSha256,
    idempotencyKey: "reply-review-comment-77",
    repo: "acme/widgets",
    pr: 32,
    expectedHead: "abcdef1234567890",
    commentId: 77,
    body,
  });
  assert.equal(plan.authorization.allowed, true);

  assert.throws(
    () =>
      planMutationRequest({
        ...plan.request,
        exactTextSha256: "wrong",
      }),
    /exact_text_hash_mismatch/,
  );
});

test("social writes require an idempotency key", () => {
  assert.throws(
    () =>
      planMutationRequest({
        schemaVersion: 1,
        action: "post_comment",
        mutationMode: "review",
        repo: "acme/widgets",
        pr: 32,
        expectedHead: "abcdef1234567890",
        body: "Status update",
      }),
    /idempotency_key_required/,
  );
});
