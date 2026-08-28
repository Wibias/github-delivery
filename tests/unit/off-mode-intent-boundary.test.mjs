import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { planMutationWithAuthority } from "../../scripts/lib/mutation-execution-context.mjs";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function mergeRequest(overrides = {}) {
  return {
    schemaVersion: 1,
    action: "merge_pr",
    mutationMode: "maintainer",
    explicitInstruction: true,
    repo: "acme/widgets",
    pr: 42,
    expectedHead: SHA_A,
    expectedBase: "main",
    expectedBaseOid: SHA_B,
    mergeMethod: "merge",
    ...overrides,
  };
}

const off = {
  config: { schemaVersion: 1, authorityMode: "off" },
  env: {},
};

test("Off mode ignores caller-attested explicit lifecycle intent", () => {
  assert.throws(
    () => planMutationWithAuthority(mergeRequest(), off),
    /mutation_denied:explicit_instruction_required/,
  );
});

test("Off mode does not elevate governing workflow context into trusted user intent", () => {
  assert.throws(
    () => planMutationWithAuthority(
      mergeRequest({ explicitInstruction: false }),
      { ...off, trustedWorkflowIntent: true },
    ),
    /mutation_denied:explicit_instruction_required/,
  );
});

test("Off mode ignores caller-attested exact-text confirmation", () => {
  const body = "Please apply the requested change.";
  assert.throws(
    () => planMutationWithAuthority({
      schemaVersion: 1,
      action: "reply_human_thread",
      mutationMode: "review",
      repo: "acme/widgets",
      pr: 42,
      expectedHead: SHA_A,
      commentId: 99,
      idempotencyKey: "reply-99",
      body,
      exactTextSha256: sha256(body),
      exactTextConfirmed: true,
    }, off),
    /mutation_denied:exact_text_confirmation_required/,
  );
});
