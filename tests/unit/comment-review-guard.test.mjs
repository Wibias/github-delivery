import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  captureCommentReviewSnapshot,
  discardCommentReviewSnapshot,
  restoreCommentReviewSnapshot,
  verifyCommentReviewSnapshot,
} from "../../scripts/comment-review-guard.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "gd-comment-review-"));
  writeFileSync(join(root, "a.ts"), Buffer.from("// keep\nconst a = 1;\n", "utf8"));
  writeFileSync(join(root, "b.ts"), Buffer.from("const b = 2;\n", "utf8"));
  return root;
}

test("captures scoped bytes, detects reviewer mutation, and restores exact bytes", () => {
  const root = fixture();
  const snapshot = join(root, ".review-snapshot.json");
  try {
    const before = readFileSync(join(root, "a.ts"));
    const captured = captureCommentReviewSnapshot({
      root,
      files: ["a.ts", "b.ts"],
      snapshotPath: snapshot,
    });
    assert.equal(captured.fileCount, 2);
    assert.equal(verifyCommentReviewSnapshot({ root, snapshotPath: snapshot }).unchanged, true);

    writeFileSync(join(root, "a.ts"), "const a = 1;\n", "utf8");
    const changed = verifyCommentReviewSnapshot({ root, snapshotPath: snapshot });
    assert.equal(changed.unchanged, false);
    assert.deepEqual(changed.changedFiles, ["a.ts"]);

    const restored = restoreCommentReviewSnapshot({ root, snapshotPath: snapshot });
    assert.deepEqual(restored.restoredFiles, ["a.ts"]);
    assert.deepEqual(readFileSync(join(root, "a.ts")), before);
    assert.equal(verifyCommentReviewSnapshot({ root, snapshotPath: snapshot }).unchanged, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("capture rejects paths outside the repository root", () => {
  const root = fixture();
  const snapshot = join(root, ".review-snapshot.json");
  try {
    assert.throws(
      () => captureCommentReviewSnapshot({ root, files: ["../outside.ts"], snapshotPath: snapshot }),
      /comment_review_scope_path_invalid/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("discard removes the private snapshot after the reviewer window", () => {
  const root = fixture();
  const snapshot = join(root, ".review-snapshot.json");
  try {
    captureCommentReviewSnapshot({ root, files: ["a.ts"], snapshotPath: snapshot });
    const result = discardCommentReviewSnapshot({ snapshotPath: snapshot });
    assert.equal(result.discarded, true);
    assert.throws(() => readFileSync(snapshot), /ENOENT/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
