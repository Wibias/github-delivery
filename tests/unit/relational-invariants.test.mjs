import assert from "node:assert/strict";
import test from "node:test";

import { refreshExpectedHeads } from "../../scripts/lib/authority-head-refresh.mjs";
import { authorityScopeSha256 } from "../../scripts/lib/authority-scope.mjs";
import { exactIdempotencyRecordMatches } from "../../scripts/lib/idempotency-receipt.mjs";

const A = "a".repeat(40);
const B = "b".repeat(40);
const MARKER = `<!-- github-delivery:idempotency ${"1".repeat(64)} -->`;

function commentRequest(overrides = {}) {
  return {
    schemaVersion: 1,
    action: "post_comment",
    mutationMode: "review",
    explicitInstruction: true,
    repo: "acme/widgets",
    pr: 32,
    expectedHead: A,
    body: "Reviewed exact head.",
    idempotencyKey: "review-32",
    ...overrides,
  };
}

test("refreshing a stale PR head changes the authority scope hash", () => {
  const request = commentRequest();
  const before = authorityScopeSha256(request);

  const refreshed = refreshExpectedHeads({
    requests: [request],
    runner() {
      return JSON.stringify({ headRefOid: B, headRefName: "feature/new-head" });
    },
  }).requests[0];

  const after = authorityScopeSha256(refreshed);
  assert.notEqual(after, before);
  assert.equal(refreshed.expectedHead, B);
  assert.equal(refreshed.authorityBranch, "feature/new-head");
});

test("binding a live branch also changes authority scope when the head is unchanged", () => {
  const request = commentRequest();
  const before = authorityScopeSha256(request);

  const refreshed = refreshExpectedHeads({
    requests: [request],
    runner() {
      return JSON.stringify({ headRefOid: A, headRefName: "feature/review" });
    },
  }).requests[0];

  assert.equal(refreshed.expectedHead, A);
  assert.equal(refreshed.authorityBranch, "feature/review");
  assert.notEqual(authorityScopeSha256(refreshed), before);
});

test("visible-effect mutations change authority scope but transport markers do not", () => {
  const request = commentRequest();
  const base = authorityScopeSha256(request);
  const changedBody = authorityScopeSha256({ ...request, body: "Different visible review." });
  const markedBody = authorityScopeSha256({ ...request, body: `${request.body}\n\n${MARKER}` });

  assert.notEqual(changedBody, base);
  assert.equal(markedBody, base);
});

test("idempotency marker alone cannot prove an effect from a foreign actor", () => {
  const request = {
    action: "post_comment",
    body: `Reviewed exact head.\n\n${MARKER}`,
    idempotencyMarker: MARKER,
  };
  const record = {
    body: request.body,
    user: { login: "other-bot" },
  };

  assert.equal(exactIdempotencyRecordMatches({ record, request, actorLogin: "github-delivery-bot" }), false);
});

test("idempotency marker cannot hide a visible-effect mismatch", () => {
  const request = {
    action: "post_comment",
    body: `Expected effect.\n\n${MARKER}`,
    idempotencyMarker: MARKER,
  };
  const record = {
    body: `Different effect.\n\n${MARKER}`,
    user: { login: "github-delivery-bot" },
  };

  assert.equal(exactIdempotencyRecordMatches({ record, request, actorLogin: "github-delivery-bot" }), false);
});

test("thread-reply idempotency is bound to the intended parent comment", () => {
  const request = {
    action: "reply_human_thread",
    body: `Addressed.\n\n${MARKER}`,
    idempotencyMarker: MARKER,
    commentId: 123,
  };
  const correct = {
    body: request.body,
    user: { login: "github-delivery-bot" },
    in_reply_to_id: 123,
  };
  const wrongParent = { ...correct, in_reply_to_id: 999 };

  assert.equal(exactIdempotencyRecordMatches({ record: correct, request, actorLogin: "github-delivery-bot" }), true);
  assert.equal(exactIdempotencyRecordMatches({ record: wrongParent, request, actorLogin: "github-delivery-bot" }), false);
});
