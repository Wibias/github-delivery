import assert from "node:assert/strict";
import test from "node:test";

import { executeMutationRequest } from "../../scripts/lib/github-mutation-broker.mjs";
import { executeMergeTransaction } from "../../scripts/merge-pr-driver.mjs";

const HEAD = "a".repeat(40);

function mergeRequest() {
  return {
    schemaVersion: 1,
    action: "merge_pr",
    mutationMode: "maintainer",
    explicitInstruction: true,
    repo: "acme/widgets",
    pr: 32,
    expectedHead: HEAD,
    mergeMethod: "merge",
  };
}

function graphqlPayload({
  state = "OPEN",
  mergedAt = null,
  inQueue = false,
  queueEntry = null,
  autoMergeRequest = null,
} = {}) {
  return JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          state,
          mergedAt,
          headRefOid: HEAD,
          isInMergeQueue: inQueue,
          mergeQueueEntry: queueEntry,
          autoMergeRequest,
        },
      },
    },
  });
}

function mergeRunner(afterMergeState, beforeMergeState = {}) {
  let mergeCalled = false;
  const calls = [];
  const runner = (command, args) => {
    calls.push([command, ...args]);
    if (command === "gh" && args[0] === "pr" && args[1] === "view") {
      if (args.includes("--jq") && args.includes(".headRefOid")) {
        return { status: 0, stdout: `${HEAD}\n`, stderr: "" };
      }
      return {
        status: 0,
        stdout: JSON.stringify({ state: "OPEN", mergedAt: null, headRefOid: HEAD }),
        stderr: "",
      };
    }
    if (command === "gh" && args[0] === "pr" && args[1] === "merge") {
      mergeCalled = true;
      return { status: 0, stdout: "accepted\n", stderr: "" };
    }
    if (command === "gh" && args[0] === "api" && args[1] === "graphql") {
      return {
        status: 0,
        stdout: graphqlPayload(mergeCalled ? afterMergeState : beforeMergeState),
        stderr: "",
      };
    }
    throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
  };
  return { runner, calls, wasMergeCalled: () => mergeCalled };
}

test("successful gh merge exit reports queued when GitHub placed the PR in merge queue", () => {
  const harness = mergeRunner({
    inQueue: true,
    queueEntry: { state: "AWAITING_CHECKS" },
  });
  const result = executeMutationRequest({
    request: mergeRequest(),
    execute: true,
    runner: harness.runner,
  });
  assert.equal(result.status, "succeeded");
  assert.equal(result.outcome, "queued");
  assert.equal(harness.wasMergeCalled(), true);
});

test("successful gh merge exit reports auto_merge_enabled when GitHub enabled auto merge", () => {
  const harness = mergeRunner({
    autoMergeRequest: { enabledAt: "2026-08-09T09:00:00Z", mergeMethod: "MERGE" },
  });
  const result = executeMutationRequest({
    request: mergeRequest(),
    execute: true,
    runner: harness.runner,
  });
  assert.equal(result.status, "succeeded");
  assert.equal(result.outcome, "auto_merge_enabled");
});

test("merge broker reports merged only when GitHub exposes merged state", () => {
  const harness = mergeRunner({
    state: "MERGED",
    mergedAt: "2026-08-09T09:00:00Z",
  });
  const result = executeMutationRequest({
    request: mergeRequest(),
    execute: true,
    runner: harness.runner,
  });
  assert.equal(result.outcome, "merged");
});

test("already merged PR is an idempotent outcome and does not invoke gh pr merge", () => {
  const harness = mergeRunner({}, {
    state: "MERGED",
    mergedAt: "2026-08-09T08:59:00Z",
  });
  const result = executeMutationRequest({
    request: mergeRequest(),
    execute: true,
    runner: harness.runner,
  });
  assert.equal(result.status, "already_applied");
  assert.equal(result.outcome, "already_merged");
  assert.equal(harness.wasMergeCalled(), false);
});

test("merge transaction does not post merged thanks for a queued outcome", () => {
  const calls = [];
  const receipts = executeMergeTransaction({
    mergeRequest: { action: "merge_pr" },
    thankRequest: { action: "post_comment" },
    executeRequest(request) {
      calls.push(request.action);
      if (request.action === "merge_pr") {
        return { action: request.action, status: "succeeded", outcome: "queued" };
      }
      return { action: request.action, status: "succeeded" };
    },
  });
  assert.deepEqual(calls, ["merge_pr"]);
  assert.deepEqual(receipts.map((item) => item.name), ["merge"]);
});

test("merge transaction posts thanks only after an actual merged outcome", () => {
  const calls = [];
  const receipts = executeMergeTransaction({
    mergeRequest: { action: "merge_pr" },
    thankRequest: { action: "post_comment" },
    executeRequest(request) {
      calls.push(request.action);
      if (request.action === "merge_pr") {
        return { action: request.action, status: "succeeded", outcome: "merged" };
      }
      return { action: request.action, status: "succeeded" };
    },
  });
  assert.deepEqual(calls, ["merge_pr", "post_comment"]);
  assert.deepEqual(receipts.map((item) => item.name), ["merge", "post_merge_thanks"]);
});
