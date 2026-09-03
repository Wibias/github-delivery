import assert from "node:assert/strict";
import test from "node:test";

import {
  lineInCommentReviewScope,
  parseCommentReviewScopePatch,
} from "../../scripts/comment-review-scope.mjs";
import { validateCommentReviewResult } from "../../scripts/comment-review-result.mjs";

const PATCH = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -2,0 +3,2 @@
+// new comment
+const value = 1;
@@ -8,2 +10 @@
-old
-old2
+// replacement comment
`;

test("comment review scope contains only new-side added lines", () => {
  const scope = parseCommentReviewScopePatch(PATCH, { baseRef: "base", headRef: "head" });
  assert.deepEqual(scope.files, [
    {
      path: "src/a.ts",
      addedRanges: [
        { start: 3, end: 4 },
        { start: 10, end: 10 },
      ],
    },
  ]);
  assert.equal(lineInCommentReviewScope(scope, "src/a.ts", 3), true);
  assert.equal(lineInCommentReviewScope(scope, "src/a.ts", 8), false);
});

test("final comment result accepts unique classifications inside added-line scope", () => {
  const scope = parseCommentReviewScopePatch(PATCH);
  const result = validateCommentReviewResult(scope, {
    schemaVersion: 1,
    kind: "github-delivery/comment-review-result",
    scopeDigest: scope.scopeDigest,
    classifications: [
      { path: "src/a.ts", line: 3, disposition: "DELETE", reason: "narration" },
      { path: "src/a.ts", line: 10, disposition: "KEEP", reason: "public API contract" },
    ],
    rootCauseFlags: [
      { path: "src/a.ts", line: 3, symbol: "value", reason: "encode the invariant" },
    ],
  });
  assert.equal(result.deletionCount, 1);
});

test("final comment result rejects pre-existing lines, duplicate classifications, and detached flags", () => {
  const scope = parseCommentReviewScopePatch(PATCH);
  const base = {
    schemaVersion: 1,
    kind: "github-delivery/comment-review-result",
    scopeDigest: scope.scopeDigest,
    rootCauseFlags: [],
  };
  assert.throws(
    () => validateCommentReviewResult(scope, {
      ...base,
      classifications: [{ path: "src/a.ts", line: 2, disposition: "DELETE", reason: "old" }],
    }),
    /comment_review_result_scope_escape/,
  );
  assert.throws(
    () => validateCommentReviewResult(scope, {
      ...base,
      classifications: [
        { path: "src/a.ts", line: 3, disposition: "DELETE", reason: "one" },
        { path: "src/a.ts", line: 3, disposition: "KEEP", reason: "two" },
      ],
    }),
    /comment_review_result_duplicate_classification/,
  );
  assert.throws(
    () => validateCommentReviewResult(scope, {
      ...base,
      classifications: [{ path: "src/a.ts", line: 3, disposition: "KEEP", reason: "keep" }],
      rootCauseFlags: [{ path: "src/a.ts", line: 3, symbol: "value", reason: "flag" }],
    }),
    /comment_review_result_flag_without_delete/,
  );
});
