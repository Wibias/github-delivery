import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("comment inspector is isolated from previous-run result files", () => {
  const workflow = read("references/no-comments.md");
  const agent = read("agents/comment-inspector.md");

  assert.match(workflow, /unique.*run.*directory|per-run.*directory/is);
  assert.match(workflow, /--run-id/);
  assert.match(workflow, /must not.*read.*previous.*comment-review-result/is);
  assert.match(agent, /must not.*read.*previous.*result|ignore.*previous.*comment-review-result/is);
  assert.match(agent, /runId/);
});
