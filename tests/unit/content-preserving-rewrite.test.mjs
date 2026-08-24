import assert from "node:assert/strict";
import test from "node:test";

import {
  assertContentPreservingRewrite,
  assertRewriteBaselineGeneration,
  parseReflogGenerationEntries,
} from "../../scripts/lib/content-preserving-rewrite.mjs";

const TREE_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TREE_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const COMMIT_A = "a1".repeat(20);
const COMMIT_B = "b2".repeat(20);
const COMMIT_C = "c3".repeat(20);

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

test("parseReflogGenerationEntries reads newest-first commit and tree SHAs", () => {
  assert.deepEqual(parseReflogGenerationEntries(`${COMMIT_C} ${TREE_A}\n${COMMIT_A} ${TREE_A}\n`), [
    { sha: COMMIT_C, tree: TREE_A },
    { sha: COMMIT_A, tree: TREE_A },
  ]);
});

test("a rewrite that starts from the recorded generation is accepted", () => {
  assert.doesNotThrow(() =>
    assertRewriteBaselineGeneration({
      recorded: COMMIT_A,
      newTip: COMMIT_C,
      recordedTree: TREE_A,
      entries: [
        { sha: COMMIT_C, tree: TREE_A },
        { sha: COMMIT_A, tree: TREE_A },
      ],
    }),
  );
});

test("a later local commit between the baseline and the rewrite fails closed", () => {
  assert.throws(
    () =>
      assertRewriteBaselineGeneration({
        recorded: COMMIT_A,
        newTip: COMMIT_C,
        recordedTree: TREE_A,
        entries: [
          { sha: COMMIT_C, tree: TREE_A },
          { sha: COMMIT_B, tree: TREE_B },
          { sha: COMMIT_A, tree: TREE_A },
        ],
      }),
    /rewrite_baseline_generation_stale/,
  );
});

test("a content-preserving squash through an ancestor with a different tree is accepted", () => {
  assert.doesNotThrow(() =>
    assertRewriteBaselineGeneration({
      recorded: COMMIT_C,
      newTip: COMMIT_B,
      recordedTree: TREE_A,
      entries: [
        { sha: COMMIT_B, tree: TREE_A },
        { sha: COMMIT_A, tree: TREE_B },
        { sha: COMMIT_C, tree: TREE_A },
      ],
      isAncestor: (sha, recorded) => sha === COMMIT_A && recorded === COMMIT_C,
    }),
  );
});

test("a later local commit is still stale when it is not an ancestor of the baseline", () => {
  assert.throws(
    () =>
      assertRewriteBaselineGeneration({
        recorded: COMMIT_A,
        newTip: COMMIT_C,
        recordedTree: TREE_A,
        entries: [
          { sha: COMMIT_C, tree: TREE_A },
          { sha: COMMIT_B, tree: TREE_B },
          { sha: COMMIT_A, tree: TREE_A },
        ],
        isAncestor: () => false,
      }),
    /rewrite_baseline_generation_stale/,
  );
});

test("a missing reflog cannot prove rewrite generation", () => {
  assert.throws(
    () =>
      assertRewriteBaselineGeneration({
        recorded: COMMIT_A,
        newTip: COMMIT_C,
        recordedTree: TREE_A,
        entries: [],
      }),
    /rewrite_baseline_generation_unproven/,
  );
});
