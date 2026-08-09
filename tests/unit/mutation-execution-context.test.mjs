import assert from "node:assert/strict";
import test from "node:test";

import {
  assertScopedTrustedAuthority,
  mutationAuthorityOptions,
  mutationRequiresTrustedAuthority,
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

test("autonomous execution always requires trusted authority", () => {
  assert.equal(
    mutationRequiresTrustedAuthority({
      mutationMode: "autonomous",
      action: "post_comment",
    }),
    true,
  );
});

test("destructive maintainer actions require trusted authority", () => {
  for (const action of [
    "push_code",
    "resolve_thread",
    "close_linked_issue",
    "close_pr",
    "merge_pr",
    "retarget_pr",
    "delete_head_branch",
  ]) {
    assert.equal(
      mutationRequiresTrustedAuthority({ mutationMode: "maintainer", action }),
      true,
      action,
    );
  }
  assert.equal(
    mutationRequiresTrustedAuthority({
      mutationMode: "maintainer",
      action: "post_comment",
    }),
    false,
  );
});

test("high-assurance authority is enforced only at execution unless globally required", () => {
  const request = { mutationMode: "maintainer", action: "merge_pr" };
  assert.equal(
    mutationAuthorityOptions({ request, enforceHighAssurance: false }).requireTrustedAuthority,
    false,
  );
  assert.equal(
    mutationAuthorityOptions({ request, enforceHighAssurance: true }).requireTrustedAuthority,
    true,
  );
  assert.equal(
    mutationAuthorityOptions({
      request: { mutationMode: "review", action: "post_comment" },
      enforceHighAssurance: false,
      env: { GITHUB_DELIVERY_REQUIRE_TRUSTED_AUTHORITY: "1" },
    }).requireTrustedAuthority,
    true,
  );
});
