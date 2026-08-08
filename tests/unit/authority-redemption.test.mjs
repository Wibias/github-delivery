import assert from "node:assert/strict";
import test from "node:test";

import { redeemAuthorityBeforeMutation } from "../../scripts/lib/authority-redemption.mjs";

function authority(overrides = {}) {
  return {
    provenance: "trusted_grant",
    verified: true,
    claims: {
      scopeSha256: "a".repeat(64),
      nonce: "gnt_1",
      batchId: "bch_1",
      batchIndex: 0,
      redemption: "required",
      ...overrides,
    },
  };
}

test("offline and caller-asserted authority does not redeem", () => {
  let calls = 0;
  const result = redeemAuthorityBeforeMutation({
    authority: { provenance: "caller_asserted", verified: false },
    authorityGrant: null,
    redeemer() { calls += 1; },
  });
  assert.equal(result, null);
  assert.equal(calls, 0);

  const result2 = redeemAuthorityBeforeMutation({
    authority: authority({ redemption: undefined }),
    authorityGrant: "gd1.a.b",
    redeemer() { calls += 1; },
  });
  assert.equal(result2, null);
  assert.equal(calls, 0);
});

test("required redemption validates a consumed receipt", () => {
  let captured;
  const result = redeemAuthorityBeforeMutation({
    authority: authority(),
    authorityGrant: "gd1.payload.signature",
    redeemer(input) {
      captured = input;
      return { status: "consumed", nonce: "gnt_1", consumedAt: 1_786_170_010 };
    },
  });
  assert.equal(captured.token, "gd1.payload.signature");
  assert.equal(captured.scopeSha256, "a".repeat(64));
  assert.equal(captured.nonce, "gnt_1");
  assert.deepEqual(result, {
    status: "consumed",
    nonce: "gnt_1",
    consumedAt: 1_786_170_010,
  });
});

test("required redemption fails closed without a configured redeemer", () => {
  assert.throws(
    () => redeemAuthorityBeforeMutation({
      authority: authority(),
      authorityGrant: "gd1.payload.signature",
    }),
    /authority_redemption_required:redeemer_missing/,
  );
});

test("redemption receipt must match the signed nonce", () => {
  assert.throws(
    () => redeemAuthorityBeforeMutation({
      authority: authority(),
      authorityGrant: "gd1.payload.signature",
      redeemer() {
        return { status: "consumed", nonce: "other", consumedAt: 1_786_170_010 };
      },
    }),
    /authority_redemption_nonce_mismatch/,
  );
});
