import assert from "node:assert/strict";
import test from "node:test";

import {
  executeMutationDocument,
  requestsFromMutationDocument,
} from "../../scripts/lib/mutation-document-execution.mjs";

function request(action, extra = {}) {
  return {
    schemaVersion: 1,
    action,
    mutationMode: "maintainer",
    explicitInstruction: true,
    repo: "acme/widgets",
    ...extra,
  };
}

test("normalizes supported mutation document shapes without mutating input", () => {
  const one = request("create_pr", { title: "One" });
  const two = request("assign_issue", { issue: 7 });

  const single = requestsFromMutationDocument(one);
  assert.equal(single.singular, true);
  assert.deepEqual(single.requests, [one]);
  assert.notEqual(single.requests[0], one);

  for (const document of [[one, two], { operations: [one, two] }, { requests: [one, two] }]) {
    const normalized = requestsFromMutationDocument(document);
    assert.equal(normalized.singular, false);
    assert.deepEqual(normalized.requests, [one, two]);
    assert.notEqual(normalized.requests[0], one);
  }

  for (const document of [null, [], {}, { operations: [] }, { requests: [] }]) {
    assert.throws(() => requestsFromMutationDocument(document), /mutation_document_requests_required/);
  }
});

test("dry-run never requests trusted authority", () => {
  let authorized = false;
  const result = executeMutationDocument({
    document: request("push_code"),
    execute: false,
    dependencies: {
      mutationRequiresTrustedAuthority: () => true,
      authorizeBatchSync() {
        authorized = true;
        throw new Error("must not authorize dry-run");
      },
      executeMutationWithAuthority({ request: planned, execute }) {
        return { action: planned.action, executed: execute };
      },
    },
  });

  assert.equal(authorized, false);
  assert.equal(result.action, "push_code");
  assert.equal(result.executed, false);
  assert.equal(result.operationKey, "push_code:acme/widgets:");
});

test("execution batches only missing trusted grants and executes refreshed requests in order", () => {
  const calls = [];
  const original = [
    request("post_comment", { pr: 4, expectedHead: "a".repeat(40), body: "first" }),
    request("assign_issue", { issue: 7, authorityGrant: "gd1.existing.signature" }),
    request("create_pr", { base: "main", head: "feature", title: "Third", body: "body" }),
  ];

  const result = executeMutationDocument({
    document: { operations: original },
    execute: true,
    runner() {
      throw new Error("refresh runner should be consumed only by injected refresh helper");
    },
    dependencies: {
      planMutationWithAuthority() {
        return { kind: "validated" };
      },
      mutationRequiresTrustedAuthority: () => true,
      refreshExpectedHeads({ requests }) {
        calls.push(["refresh", requests.map((entry) => entry.action)]);
        return {
          requests: requests.map((entry) =>
            entry.action === "post_comment"
              ? { ...entry, expectedHead: "b".repeat(40) }
              : entry,
          ),
          refreshed: [],
        };
      },
      authorizeBatchSync(requests) {
        calls.push(["authorize", requests.map((entry) => [entry.action, entry.expectedHead ?? null])]);
        return {
          batchId: "batch-1",
          grants: requests.map((_, operation) => ({
            operation,
            token: `gd1.generated${operation}.signature`,
          })),
        };
      },
      attachAuthorityGrants(requests, authorization) {
        calls.push(["attach", authorization.batchId]);
        return {
          batchId: authorization.batchId,
          requests: requests.map((entry, index) => ({
            ...entry,
            authorityGrant: authorization.grants[index].token,
          })),
        };
      },
      stampAuthorizedReviewVerdicts(batch) {
        calls.push(["stamp", batch.batchId]);
        return batch;
      },
      executeMutationWithAuthority({ request: executed }) {
        calls.push(["execute", executed.action, executed.expectedHead ?? null, executed.authorityGrant]);
        return { action: executed.action, grant: executed.authorityGrant };
      },
    },
  });

  assert.deepEqual(calls[0], ["refresh", ["post_comment", "create_pr"]]);
  assert.deepEqual(calls[1], [
    "authorize",
    [
      ["post_comment", "b".repeat(40)],
      ["create_pr", null],
    ],
  ]);
  assert.equal(calls.filter((entry) => entry[0] === "execute").length, 3);
  assert.deepEqual(calls.find((entry) => entry[0] === "execute" && entry[1] === "assign_issue"), [
    "execute",
    "assign_issue",
    null,
    "gd1.existing.signature",
  ]);
  assert.deepEqual(result, {
    batch: true,
    partialFailure: false,
    results: [
      {
        action: "post_comment",
        grant: "gd1.generated0.signature",
        operationKey: "post_comment:acme/widgets:4",
      },
      {
        action: "assign_issue",
        grant: "gd1.existing.signature",
        operationKey: "assign_issue:acme/widgets:7",
      },
      {
        action: "create_pr",
        grant: "gd1.generated1.signature",
        operationKey: "create_pr:acme/widgets:",
      },
    ],
  });
});

test("multi-request execution stops at the first failed operation", () => {
  const executed = [];
  const persisted = [];
  const result = executeMutationDocument({
    document: [request("one"), request("two"), request("three")],
    execute: false,
    dependencies: {
      mutationRequiresTrustedAuthority: () => false,
      onReceipt(receipt) {
        persisted.push(receipt.action);
      },
      executeMutationWithAuthority({ request: current }) {
        executed.push(current.action);
        if (current.action === "two") throw new Error("second failed");
        return { action: current.action, status: "succeeded" };
      },
    },
  });
  assert.deepEqual(executed, ["one", "two"]);
  assert.deepEqual(persisted, ["one", "two"]);
  assert.equal(result.partialFailure, true);
  assert.equal(result.results[0].status, "succeeded");
  assert.equal(result.results[1].status, "failed");
  assert.equal(result.results[1].error, "second failed");
  assert.equal(result.results.length, 2);
});

test("retries skip operations that already completed", () => {
  const executed = [];
  const result = executeMutationDocument({
    document: [request("one", { idempotencyKey: "k-one" }), request("two", { idempotencyKey: "k-two" })],
    execute: false,
    dependencies: {
      completedOperationKeys: ["k-one"],
      mutationRequiresTrustedAuthority: () => false,
      executeMutationWithAuthority({ request: current }) {
        executed.push(current.action);
        return { action: current.action, status: "succeeded" };
      },
    },
  });
  assert.deepEqual(executed, ["two"]);
  assert.equal(result.results[0].status, "already_applied");
  assert.equal(result.results[0].skipped, true);
  assert.equal(result.results[1].action, "two");
  assert.equal(result.partialFailure, false);
});

test("execution validates every request before prompting for authority", () => {
  let authorized = false;
  let executed = false;

  assert.throws(
    () =>
      executeMutationDocument({
        document: request("create_pr"),
        execute: true,
        dependencies: {
          mutationRequiresTrustedAuthority: () => true,
          planMutationWithAuthority() {
            throw new Error("mutation_denied:explicit_instruction_required");
          },
          authorizeBatchSync() {
            authorized = true;
            throw new Error("must not prompt before validation");
          },
          executeMutationWithAuthority() {
            executed = true;
            return {};
          },
        },
      }),
    /mutation_denied:explicit_instruction_required/,
  );

  assert.equal(authorized, false);
  assert.equal(executed, false);
});
