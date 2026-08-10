import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTHORITY_PROTOCOL,
  AUTHORITY_HOST_BUSY_ERROR,
  decodeAuthorityFrame,
  encodeAuthorityFrame,
  normalizePipeName,
  withBusyRetry,
} from "../../scripts/lib/authority-host-client.mjs";
import { attachAuthorityGrants } from "../../scripts/lib/authority-batch.mjs";

test("authority protocol frames use a 4-byte little-endian length prefix", () => {
  const message = { protocol: AUTHORITY_PROTOCOL, id: "1", method: "status", params: {} };
  const frame = encodeAuthorityFrame(message);
  assert.equal(frame.readUInt32LE(0), frame.length - 4);
  assert.deepEqual(decodeAuthorityFrame(frame), message);
});

test("oversized authority responses fail closed", () => {
  const payload = Buffer.alloc(300 * 1024, 0x61);
  const frame = Buffer.alloc(payload.length + 4);
  frame.writeUInt32LE(payload.length, 0);
  payload.copy(frame, 4);
  assert.throws(() => decodeAuthorityFrame(frame), /authority_frame_too_large/);
});

test("pipe names are normalized without accepting arbitrary filesystem paths", () => {
  assert.equal(normalizePipeName("github-delivery-authority-v1"), "github-delivery-authority-v1");
  assert.equal(normalizePipeName("  github-delivery-authority-v1  "), "github-delivery-authority-v1");
  assert.throws(() => normalizePipeName("../pipe"), /authority_pipe_name_invalid/);
  assert.throws(() => normalizePipeName("C:\\temp\\pipe"), /authority_pipe_name_invalid/);
});

test("returned grants are attached by operation index without trusting response order", () => {
  const operations = [
    { action: "post_comment", repo: "acme/widgets" },
    { action: "merge_pr", repo: "acme/widgets" },
  ];
  const result = attachAuthorityGrants(operations, {
    batchId: "bch_1",
    expiresAt: 123,
    grants: [
      { operation: 1, token: "gd1.merge.sig", scopeSha256: "b".repeat(64) },
      { operation: 0, token: "gd1.comment.sig", scopeSha256: "a".repeat(64) },
    ],
  });
  assert.equal(result.requests[0].authorityGrant, "gd1.comment.sig");
  assert.equal(result.requests[1].authorityGrant, "gd1.merge.sig");
});

test("missing or duplicate operation grants are rejected", () => {
  const operations = [{ action: "merge_pr" }, { action: "close_linked_issue" }];
  assert.throws(
    () => attachAuthorityGrants(operations, { grants: [{ operation: 0, token: "gd1.a.b" }] }),
    /authority_grant_count_mismatch/,
  );
  assert.throws(
    () => attachAuthorityGrants(operations, {
      grants: [
        { operation: 0, token: "gd1.a.b" },
        { operation: 0, token: "gd1.c.d" },
      ],
    }),
    /authority_grant_operation_duplicate/,
  );
});

test("busy retry waits for a pending Hello prompt and succeeds when the host frees up", () => {
  let calls = 0;
  const result = withBusyRetry(() => {
    calls += 1;
    if (calls < 3) {
      const error = new Error(AUTHORITY_HOST_BUSY_ERROR);
      throw error;
    }
    return { batchId: "bch_retry" };
  }, {
    busyRetryBaseMs: 1,
  });
  assert.equal(calls, 3);
  assert.equal(result.batchId, "bch_retry");
});

test("busy retry fails with a clear wait-for-hello error after the deadline", () => {
  let calls = 0;
  assert.throws(
    () => withBusyRetry(() => {
      calls += 1;
      throw new Error(AUTHORITY_HOST_BUSY_ERROR);
    }, {
      busyTimeoutMs: 5,
      busyRetryBaseMs: 1,
    }),
    /authority_host_still_busy:wait_for_pending_hello/,
  );
  assert.ok(calls >= 2, "retry should attempt more than once before giving up");
});

test("busy retry rethrows non-busy errors immediately", () => {
  assert.throws(
    () => withBusyRetry(() => {
      throw new Error("authority_host_error:user_denied");
    }, {
      busyTimeoutMs: 5,
      busyRetryBaseMs: 1,
    }),
    /authority_host_error:user_denied/,
  );
});

test("busy retry validates its timeout parameters", () => {
  assert.throws(
    () => withBusyRetry(() => "ok", { busyTimeoutMs: 0 }),
    /authority_busy_timeout_invalid/,
  );
  assert.throws(
    () => withBusyRetry(() => "ok", { busyRetryBaseMs: 0 }),
    /authority_busy_retry_base_invalid/,
  );
  assert.throws(
    () => withBusyRetry("not-a-function"),
    /authority_busy_retry_call_required/,
  );
});
