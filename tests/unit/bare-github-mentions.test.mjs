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

test("merge workflow keeps hardened broker architecture and bare mentions", () => {
  const source = read("references/merge-pr.md");
  assert.match(source, /Routine visible GitHub writes use `scripts\/github-mutate\.mjs`/);
  assert.match(source, /Merge is the deliberate exception at the public boundary/);
  assert.match(source, /generic `merge_pr` mutation documents are forbidden/);
  assert.match(source, /keep GitHub `@mentions` bare and never backticked/);
  assert.match(source, /keep the real `@login` bare and omit self-thanks/);
  assert.doesNotMatch(source, /<<<<<<<|=======|>>>>>>>/);
});

test("create-PR lifecycle has no executable bare GitHub or remote-Git mutation commands", () => {
  const source = read("references/create-pr-for-issue.md");
  assert.match(source, /broker action `push_code`/);
  assert.match(source, /broker action `create_pr`/);
  assert.match(source, /broker action `update_pr_body`/);
  assert.match(source, /broker action `assign_issue`/);
  assert.doesNotMatch(source, /^\s*git\s+push\b/m);
  assert.doesNotMatch(source, /^\s*gh\s+pr\s+create\b/m);
  assert.doesNotMatch(source, /^\s*gh\s+pr\s+edit\b/m);
  assert.doesNotMatch(source, /^\s*gh\s+issue\s+edit\b/m);
});

test("stack restacks publish only through the push_code broker action", () => {
  const source = read("references/stacked-prs.md");
  assert.match(source, /action": "push_code"/);
  assert.match(source, /expectedRemoteTip/);
  assert.match(source, /forceWithLease/);
  assert.doesNotMatch(source, /^\s*git\s+push\b/m);
});
