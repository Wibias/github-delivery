import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("broad migrations use a bounded change-execution contract", () => {
  const executionUrl = new URL(
    "../../references/change-execution.md",
    import.meta.url,
  );
  assert.ok(existsSync(executionUrl), "expected change-execution companion");

  const execution = readFileSync(executionUrl, "utf8");

  assert.match(execution, /Inventory the whole migration surface/i);
  assert.match(execution, /Migrate callers, then delete obsolete internal paths/i);
  assert.match(execution, /Do not keep an internal legacy path solely because migrating callers is inconvenient/i);
  assert.match(execution, /Build a lever when it lowers change risk/i);
  assert.match(execution, /Do not require automation when a small manual edit is clearer/i);
  assert.match(execution, /Sequence verifiable units/i);
  assert.match(execution, /does not have to map one-to-one to Git commits/i);
  assert.match(execution, /residual searches for old names\/shapes/i);
  assert.match(execution, /pstack/i);
});

test("refactor planning and issue implementation invoke change execution only when relevant", () => {
  const issueWorkflows = read("references/issue-workflows.md");
  const createPr = read("references/create-pr-for-issue.md");

  assert.match(issueWorkflows, /references\/change-execution\.md/);
  assert.match(issueWorkflows, /Migration Surface and Compatibility Decision/i);
  assert.match(issueWorkflows, /Lever Decision and Completion Proof/i);
  assert.match(issueWorkflows, /temporary non-shippable intermediate state/i);

  assert.match(createPr, /references\/change-execution\.md/);
  assert.match(createPr, /broad migrations or deterministic sweeps/i);
});
