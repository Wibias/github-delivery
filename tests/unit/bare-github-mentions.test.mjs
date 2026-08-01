import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

test("skill policy exempts GitHub mentions from code formatting", () => {
  const source = read("SKILL.md");
  assert.match(
    source,
    /never wrap GitHub `@login` mentions in backticks/,
  );
});

test("public comment templates use notifying mention syntax", () => {
  const source = read("references/comment-depth.md");
  assert.match(source, /Thanks @author — merging this\./);
  assert.match(source, /Thanks @issue_author — fixed by PR/);
  assert.match(source, /pending @login \(bare `@`, never backticked\)/);
  assert.match(source, /write `@user`, never `` `@user` ``/);
});

test("merge workflow keeps broker architecture and bare mentions", () => {
  const source = read("references/merge-pr.md");
  assert.match(source, /Every visible GitHub write must pass through `scripts\/github-mutate\.mjs`/);
  assert.match(source, /keep GitHub `@mentions` bare and never backticked/);
  assert.match(source, /keep the real `@login` bare and omit self-thanks/);
  assert.doesNotMatch(source, /<<<<<<<|=======|>>>>>>>/);
});
