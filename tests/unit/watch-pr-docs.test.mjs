import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("autonomous watch merge uses the merge driver and waits on unknown merge state", () => {
  const watch = read("references/watch-pr.md");
  assert.match(watch, /merge-pr-driver\.mjs/);
  assert.match(watch, /explicitActions/);
  assert.match(watch, /push_code/);
  assert.match(watch, /pr_session|PR session/);
  assert.match(watch, /github_merge_state_unknown|UNKNOWN/);
});
