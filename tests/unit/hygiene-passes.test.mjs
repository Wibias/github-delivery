import assert from "node:assert/strict";
import test from "node:test";

import { composedHygienePasses } from "../../scripts/lib/hygiene-passes.mjs";

const COMPOSED = [
  "references/full-review-pr.md",
  "references/re-review-pr.md",
  "references/fix-pr-bots.md",
  "references/create-pr-for-issue.md",
  "references/create-pr-from-local-work.md",
  "references/prepare-and-merge-pr.md",
];

test("composed review defaults both passes on", () => {
  for (const workflow of COMPOSED) {
    assert.deepEqual(composedHygienePasses("full review PR #42", workflow), {
      noComments: "run",
      simplify: "run",
      skipNoCommentsReason: null,
      skipSimplifyReason: null,
    }, workflow);
  }
});

test("opt-out is independent and does not treat bare no comments as skip", () => {
  const withoutSimplify = composedHygienePasses(
    "full review PR #42 without simplify",
    "references/full-review-pr.md",
  );
  assert.equal(withoutSimplify.noComments, "run");
  assert.equal(withoutSimplify.simplify, "skip");
  assert.equal(withoutSimplify.skipSimplifyReason, "without simplify");

  const skipNoComments = composedHygienePasses(
    "full review PR #42 skip no-comments",
    "references/full-review-pr.md",
  );
  assert.equal(skipNoComments.noComments, "skip");
  assert.equal(skipNoComments.simplify, "run");
  assert.equal(skipNoComments.skipNoCommentsReason, "skip no-comments");

  const both = composedHygienePasses(
    "full review PR #42 skip no-comments and without simplify",
    "references/full-review-pr.md",
  );
  assert.equal(both.noComments, "skip");
  assert.equal(both.simplify, "skip");

  assert.equal(
    composedHygienePasses("full review PR #42 no comments", "references/full-review-pr.md").noComments,
    "run",
  );
  assert.equal(
    composedHygienePasses("full review PR #42 keep source comments", "references/full-review-pr.md").noComments,
    "skip",
  );
  assert.equal(
    composedHygienePasses("merge-ready skip simplify", "references/fix-pr-bots.md").simplify,
    "skip",
  );
  assert.equal(
    composedHygienePasses("full review PR #42 don't strip comments", "references/full-review-pr.md").noComments,
    "skip",
  );
});

test("status does not compose hygiene passes", () => {
  const result = composedHygienePasses("is PR #42 merge ready?", "references/status.md");
  assert.deepEqual(result, {
    noComments: "n/a",
    simplify: "n/a",
    skipNoCommentsReason: null,
    skipSimplifyReason: null,
  });
});

test("standalone no-comments always runs that pass", () => {
  const result = composedHygienePasses("no-comments PR #42", "references/no-comments.md");
  assert.equal(result.noComments, "run");
  assert.equal(result.simplify, "n/a");
});

test("standalone simplify always runs that pass", () => {
  const result = composedHygienePasses("simplify PR #42 without changing behavior", "references/simplify-pr.md");
  assert.equal(result.simplify, "run");
  assert.equal(result.noComments, "n/a");
});
