import assert from "node:assert/strict";
import test from "node:test";

import {
  executeMutationWithAuthority,
  mutationAuthorityOptions,
  mutationAuthorityRequired,
} from "../../scripts/lib/mutation-execution-context.mjs";
import { mutationRequiresIndependentIntent } from "../../scripts/lib/mutation-policy.mjs";
import { executeMutationDocument } from "../../scripts/lib/mutation-document-execution.mjs";

function request(action = "merge_pr", extra = {}) {
  return {
    schemaVersion: 1,
    action,
    mutationMode: "maintainer",
    explicitInstruction: true,
    repo: "acme/widgets",
    pr: 42,
    expectedHead: "a".repeat(40),
    ...extra,
  };
}

test("off mode removes the trusted-authority requirement from high-assurance execution that is not independent intent", () => {
  const comment = request("post_comment", {
    body: "status update",
    idempotencyKey: "comment-1",
  });
  const options = mutationAuthorityOptions({
    request: comment,
    enforceHighAssurance: true,
    env: {},
    config: { schemaVersion: 1, authorityMode: "off" },
  });
  assert.equal(options.authorityMode, "off");
  assert.equal(options.requireTrustedAuthority, false);
  assert.equal(
    mutationAuthorityRequired(comment, {
      execute: true,
      env: {},
      config: { schemaVersion: 1, authorityMode: "off" },
    }),
    false,
  );
});

test("off mode still requires a trusted grant for explicit lifecycle intent and exact-text consent", () => {
  const off = { schemaVersion: 1, authorityMode: "off" };
  const merge = request("merge_pr", {
    expectedBase: "main",
    expectedBaseOid: "b".repeat(40),
    mergeMethod: "merge",
  });
  const reply = request("reply_human_thread", {
    mutationMode: "review",
    exactTextConfirmed: true,
    exactTextSha256: "a".repeat(64),
    commentId: 77,
    body: "Thanks, this is fixed.",
    idempotencyKey: "reply-1",
    explicitInstruction: false,
  });

  assert.equal(mutationRequiresIndependentIntent(merge), true);
  assert.equal(mutationRequiresIndependentIntent(reply), true);
  assert.equal(mutationRequiresIndependentIntent(request("post_comment")), false);

  for (const actionRequest of [merge, reply]) {
    assert.equal(
      mutationAuthorityRequired(actionRequest, {
        execute: true,
        env: {},
        config: off,
      }),
      true,
      actionRequest.action,
    );
    assert.equal(
      mutationAuthorityOptions({
        request: actionRequest,
        enforceHighAssurance: true,
        env: {},
        config: off,
      }).requireTrustedAuthority,
      true,
      actionRequest.action,
    );
  }
});

test("off-mode execution cannot satisfy independent intent from caller-asserted booleans", () => {
  const offEnv = { GITHUB_DELIVERY_AUTHORITY_MODE: "off" };
  for (const actionRequest of [
    request("merge_pr", {
      expectedBase: "main",
      expectedBaseOid: "b".repeat(40),
      mergeMethod: "merge",
    }),
    request("reply_human_thread", {
      mutationMode: "review",
      exactTextConfirmed: true,
      commentId: 77,
      body: "Thanks, this is fixed.",
      idempotencyKey: "reply-1",
      explicitInstruction: false,
    }),
  ]) {
    let calls = 0;
    assert.throws(
      () =>
        executeMutationWithAuthority({
          request: actionRequest,
          execute: true,
          env: offEnv,
          config: { schemaVersion: 1, authorityMode: "off" },
          runner() {
            calls += 1;
            return { status: 0, stdout: "", stderr: "" };
          },
        }),
      /trusted_authority_required/,
      actionRequest.action,
    );
    assert.equal(calls, 0, actionRequest.action);
  }
});

test("high-assurance mode preserves the intrinsic high-assurance and autonomous boundary", () => {
  assert.equal(
    mutationAuthorityRequired(request(), {
      execute: true,
      env: {},
      config: { schemaVersion: 1, authorityMode: "high-assurance" },
    }),
    true,
  );
  assert.equal(
    mutationAuthorityRequired(
      request("post_comment", { mutationMode: "autonomous" }),
      {
        execute: true,
        env: {},
        config: { schemaVersion: 1, authorityMode: "high-assurance" },
      },
    ),
    true,
  );
  assert.equal(
    mutationAuthorityRequired(
      request("draft_text", { mutationMode: "read-only", pr: undefined, expectedHead: undefined }),
      {
        execute: true,
        env: {},
        config: { schemaVersion: 1, authorityMode: "high-assurance" },
      },
    ),
    false,
  );
});

test("all mode requires trusted authority for every executed mutation", () => {
  assert.equal(
    mutationAuthorityRequired(
      request("draft_text", { mutationMode: "read-only", pr: undefined, expectedHead: undefined }),
      {
        execute: true,
        env: {},
        config: { schemaVersion: 1, authorityMode: "all" },
      },
    ),
    true,
  );
});

test("dry-run never requires trusted authority regardless of configured mode", () => {
  assert.equal(
    mutationAuthorityRequired(request(), {
      execute: false,
      env: {},
      config: { schemaVersion: 1, authorityMode: "all" },
    }),
    false,
  );
});

test("legacy strict env still forces all mode", () => {
  const options = mutationAuthorityOptions({
    request: request("draft_text", { mutationMode: "read-only", pr: undefined, expectedHead: undefined }),
    enforceHighAssurance: true,
    env: { GITHUB_DELIVERY_REQUIRE_TRUSTED_AUTHORITY: "1" },
    config: { schemaVersion: 1, authorityMode: "off" },
  });
  assert.equal(options.authorityMode, "all");
  assert.equal(options.requireTrustedAuthority, true);
});

test("mutation document prompts in off mode for exact-text human replies", () => {
  let authorized = 0;
  const result = executeMutationDocument({
    document: request("reply_human_thread", {
      mutationMode: "review",
      exactTextConfirmed: true,
      commentId: 77,
      body: "Thanks, this is fixed.",
      idempotencyKey: "reply-1",
      explicitInstruction: false,
    }),
    execute: true,
    env: { GITHUB_DELIVERY_AUTHORITY_MODE: "off" },
    dependencies: {
      planMutationWithAuthority() {
        return { kind: "validated" };
      },
      refreshExpectedHeads({ requests }) {
        return { requests, refreshed: [] };
      },
      authorizeBatchSync(requests) {
        authorized += 1;
        return {
          batchId: "batch-1",
          grants: requests.map((_, operation) => ({
            operation,
            token: `gd1.token${operation}.signature`,
          })),
        };
      },
      attachAuthorityGrants(requests, authorization) {
        return {
          batchId: authorization.batchId,
          requests: requests.map((entry, index) => ({
            ...entry,
            authorityGrant: authorization.grants[index].token,
          })),
        };
      },
      stampAuthorizedReviewVerdicts(batch) {
        return batch;
      },
      executeMutationWithAuthority({ request: executedRequest }) {
        return { action: executedRequest.action, grant: executedRequest.authorityGrant };
      },
    },
  });
  assert.equal(authorized, 1);
  assert.equal(result.action, "reply_human_thread");
  assert.equal(result.grant, "gd1.token0.signature");
});

test("mutation document does not prompt in off mode even when the action is intrinsically high assurance", () => {
  let authorized = false;
  let executed = false;
  const result = executeMutationDocument({
    document: request("post_comment", { body: "hello", idempotencyKey: "test-key" }),
    execute: true,
    env: {},
    dependencies: {
      planMutationWithAuthority() {
        return { kind: "validated" };
      },
      mutationRequiresTrustedAuthority: () => true,
      mutationAuthorityRequired: () => false,
      authorizeBatchSync() {
        authorized = true;
        throw new Error("off mode must not prompt");
      },
      executeMutationWithAuthority({ request: executedRequest }) {
        executed = true;
        return { action: executedRequest.action, executed: true };
      },
    },
  });
  assert.equal(authorized, false);
  assert.equal(executed, true);
  assert.equal(result.action, "post_comment");
  assert.equal(result.executed, true);
  assert.equal(result.operationKey, "test-key");
});

test("mutation document still batches authority in high-assurance mode", () => {
  let authorized = 0;
  const result = executeMutationDocument({
    document: request("post_comment", { body: "hello", idempotencyKey: "test-key" }),
    execute: true,
    env: {},
    dependencies: {
      planMutationWithAuthority() {
        return { kind: "validated" };
      },
      mutationRequiresTrustedAuthority: () => true,
      mutationAuthorityRequired: () => true,
      refreshExpectedHeads({ requests }) {
        return { requests, refreshed: [] };
      },
      authorizeBatchSync(requests) {
        authorized += 1;
        return {
          batchId: "batch-1",
          grants: requests.map((_, operation) => ({
            operation,
            token: `gd1.token${operation}.signature`,
          })),
        };
      },
      attachAuthorityGrants(requests, authorization) {
        return {
          batchId: authorization.batchId,
          requests: requests.map((entry, index) => ({
            ...entry,
            authorityGrant: authorization.grants[index].token,
          })),
        };
      },
      stampAuthorizedReviewVerdicts(batch) {
        return batch;
      },
      executeMutationWithAuthority({ request: executedRequest }) {
        return { action: executedRequest.action, grant: executedRequest.authorityGrant };
      },
    },
  });
  assert.equal(authorized, 1);
  assert.equal(result.action, "post_comment");
  assert.equal(result.grant, "gd1.token0.signature");
});
