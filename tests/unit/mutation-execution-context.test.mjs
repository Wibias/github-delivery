import assert from "node:assert/strict";
import test from "node:test";

import {
  assertScopedTrustedAuthority,
} from "../../scripts/lib/mutation-execution-context.mjs";

const scoped = {
  verified: true,
  provenance: "trusted_grant",
  claims: { scopeSha256: "a".repeat(64) },
};

const unscoped = {
  verified: true,
  provenance: "trusted_grant",
  claims: { nonce: "legacy" },
};

test("strict trusted authority rejects a verified legacy grant without scope binding", () => {
  assert.throws(
    () =>
      assertScopedTrustedAuthority(unscoped, {
        requireTrustedAuthority: true,
      }),
    /trusted_authority_required:scope_hash_missing/,
  );
});

test("strict trusted authority accepts an exact scoped grant", () => {
  assert.equal(
    assertScopedTrustedAuthority(scoped, { requireTrustedAuthority: true }),
    scoped,
  );
});

test("compatibility mode can still inspect a legacy unscoped grant", () => {
  assert.equal(
    assertScopedTrustedAuthority(unscoped, { requireTrustedAuthority: false }),
    unscoped,
  );
});
