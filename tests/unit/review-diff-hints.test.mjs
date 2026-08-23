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

test("operational policy and GitHub paths follow review-scope logic", () => {
  assert.equal(classifyReviewFileRole("references/policy/git.md"), "core");
  assert.equal(classifyReviewFileRole(".github/workflows/ci.yml"), "core");
  assert.equal(classifyReviewFileRole("SKILL.md"), "core");
});

test("mechanical dirs are path segments, not prefix matches", () => {
  assert.equal(classifyReviewFileRole("dist/bundle.js"), "mechanical");
  assert.equal(classifyReviewFileRole("build-tools/help.mjs"), "core");
  assert.equal(classifyReviewFileRole("generated-client/api.ts"), "core");
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

test("near relocation keeps modified lines out of the not-new-logic count", () => {
  const patch = [
    "@@ -1,12 +1,12 @@",
    "-alpha()",
    "-bravo()",
    "-charlie()",
    "-delta()",
    "-echo()",
    "-foxtrot()",
    "-golf()",
    "-hotel()",
    "-india()",
    "-oldBehavior()",
    "+alpha()",
    "+bravo()",
    "+charlie()",
    "+delta()",
    "+echo()",
    "+foxtrot()",
    "+golf()",
    "+hotel()",
    "+india()",
    "+newBehavior()",
  ].join("\n");
  const summary = summarizeMovedCode(patch, "src/app.mjs");
  assert.equal(summary.movedLineCount, 9);
  assert.equal(summary.changedLineCount, 1);
  assert.equal(summary.exact, false);
});

test("python indentation changes are not exact relocations", () => {
  const patch = [
    "@@ -1,6 +1,6 @@",
    "-def run():",
    "-    if ready:",
    "-        work()",
    "+def run():",
    "+if ready:",
    "+    work()",
  ].join("\n");
  assert.equal(summarizeMovedCode(patch, "src/app.py"), null);
});

test("whitespace inside JS strings is not exact moved code", () => {
  const patch = [
    "@@ -1,6 +1,6 @@",
    `-const label = "a  b";`,
    "-return label;",
    "-use(label);",
    `+const label = "a b";`,
    "+return label;",
    "+use(label);",
  ].join("\n");
  const summary = summarizeMovedCode(patch, "src/app.mjs");
  assert.equal(summary.movedLineCount, 3);
  assert.equal(summary.changedLineCount, 1);
  assert.equal(summary.exact, false);
});

test("template literal content changes are not exact moved code", () => {
  const patch = [
    "@@ -1,6 +1,6 @@",
    "-const msg = `hello  world`;",
    "-return msg;",
    "-use(msg);",
    "+const msg = `hello world`;",
    "+return msg;",
    "+use(msg);",
  ].join("\n");
  const summary = summarizeMovedCode(patch, "src/app.mjs");
  assert.equal(summary.movedLineCount, 3);
  assert.equal(summary.changedLineCount, 1);
  assert.equal(summary.exact, false);
});

test("significant trailing whitespace is not exact moved code", () => {
  const patch = [
    "@@ -1,6 +1,6 @@",
    "-const keep = value;",
    "-return keep;  ",
    "-use(keep);",
    "+const keep = value;",
    "+return keep;",
    "+use(keep);",
  ].join("\n");
  const summary = summarizeMovedCode(patch, "src/app.mjs");
  assert.equal(summary.movedLineCount, 3);
  assert.equal(summary.changedLineCount, 1);
  assert.equal(summary.exact, false);
});
