import assert from "node:assert/strict";
import test from "node:test";

import { assertContentPreservingRewrite } from "../../scripts/lib/content-preserving-rewrite.mjs";

const TREE_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TREE_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

test("matching trees pass a content-preserving rewrite", () => {
  assert.deepEqual(
    assertContentPreservingRewrite({
      originalTree: TREE_A.toUpperCase(),
      newTree: TREE_A,
    }),
    { originalTree: TREE_A, newTree: TREE_A },
  );
});

test("a changed tree fails closed before a force-with-lease push", () => {
  assert.throws(
    () =>
      assertContentPreservingRewrite({
        originalTree: TREE_A,
        newTree: TREE_B,
      }),
    /content_preserving_rewrite_tree_mismatch/,
  );
});

test("missing or malformed tree SHAs fail closed", () => {
  assert.throws(
    () => assertContentPreservingRewrite({ originalTree: "", newTree: TREE_A }),
    /original_tree_required/,
  );
  assert.throws(
    () =>
      assertContentPreservingRewrite({
        originalTree: TREE_A,
        newTree: "not-a-sha",
      }),
    /new_tree_invalid/,
  );
});
