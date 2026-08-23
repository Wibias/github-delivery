import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyReviewFileRole,
  summarizeMovedCode,
} from "../../scripts/lib/review-diff-hints.mjs";

test("lockfiles, maps, and generated snapshots are mechanical", () => {
  assert.equal(classifyReviewFileRole("package-lock.json"), "mechanical");
  assert.equal(classifyReviewFileRole("pnpm-lock.yaml"), "mechanical");
  assert.equal(classifyReviewFileRole("dist/bundle.js.map"), "mechanical");
  assert.equal(classifyReviewFileRole("tests/unit/foo.test.mjs.snap"), "mechanical");
});

test("implementation files stay core", () => {
  assert.equal(classifyReviewFileRole("scripts/lib/review-brief.mjs"), "core");
  assert.equal(classifyReviewFileRole("src/App.tsx"), "core");
});

test("docs and changelog are neither core nor mechanical", () => {
  assert.equal(classifyReviewFileRole("CHANGELOG.md"), "other");
  assert.equal(classifyReviewFileRole("README.md"), "other");
});

test("detects a relocated block of three or more lines", () => {
  const patch = [
    "@@ -1,8 +1,8 @@",
    " keep",
    "-alpha",
    "-bravo",
    "-charlie",
    " middle",
    "+alpha",
    "+bravo",
    "+charlie",
    " after",
  ].join("\n");
  const summary = summarizeMovedCode(patch);
  assert.equal(summary.movedLineCount, 3);
  assert.equal(summary.exact, true);
});

test("does not treat an unrelated add/delete as a move", () => {
  const patch = [
    "@@ -1,4 +1,4 @@",
    "-oldBehavior()",
    "+newBehavior()",
    " stay",
  ].join("\n");
  assert.equal(summarizeMovedCode(patch), null);
});
