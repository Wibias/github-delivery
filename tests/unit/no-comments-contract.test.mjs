import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const COMPOSED = [
  "references/full-review-pr.md",
  "references/re-review-pr.md",
  "references/fix-pr-bots.md",
  "references/create-pr-for-issue.md",
  "references/create-pr-from-local-work.md",
  "references/prepare-and-merge-pr.md",
];

test("no-comments workflow and comment inspector exist with policy modules", () => {
  const workflowUrl = new URL("../../references/no-comments.md", import.meta.url);
  const agentUrl = new URL("../../agents/comment-inspector.md", import.meta.url);
  assert.ok(existsSync(workflowUrl), "expected references/no-comments.md");
  assert.ok(existsSync(agentUrl), "expected agents/comment-inspector.md");
  assert.equal(existsSync(new URL("../../agents/comment-sicko.md", import.meta.url)), false);

  const workflow = readFileSync(workflowUrl, "utf8");
  assert.match(workflow, /policy-modules:start/);
  assert.match(workflow, /policy-kernel/);
  assert.match(workflow, /mutation/);
  assert.match(workflow, /evidence/);
  assert.match(workflow, /git/);
  assert.match(workflow, /reviews/);
  assert.match(workflow, /stacks \(when stack topology is detected\)/);
});

test("keep-list is not a zero-comments ban and has no encode-later catch-all", () => {
  const workflow = read("references/no-comments.md");
  const agent = read("agents/comment-inspector.md");
  for (const text of [workflow, agent]) {
    assert.match(text, /license/i);
    assert.match(text, /public API/i);
    assert.match(text, /RFC/i);
    assert.match(text, /external/i);
    assert.match(text, /prettier-ignore/);
    assert.doesNotMatch(text, /cannot encode in this pass/i);
  }
});

test("alibi comments and narration are guilty", () => {
  const workflow = read("references/no-comments.md");
  assert.match(workflow, /Phase 1: add cards/);
  assert.match(workflow, /fine for now, skip validation/);
  assert.match(workflow, /root-cause flag/i);
  assert.match(workflow, /@ts-expect-error|@ts-ignore/);
  assert.doesNotMatch(workflow, /MUST KILL/);
  assert.doesNotMatch(workflow, /delete-on-doubt|when I am not sure a keep clause applies, the comment dies/i);
});

test("comment inspector never writes application code and parent inspects", () => {
  const agent = read("agents/comment-inspector.md");
  const workflow = read("references/no-comments.md");
  assert.match(agent, /never write application code/i);
  assert.match(workflow, /agents\/comment-inspector\.md/);
  assert.match(workflow, /must spawn/i);
  assert.match(workflow, /comment inspector/i);
  assert.match(workflow, /parent fallback/i);
  assert.match(workflow, /application-code edits/);
  assert.match(workflow, /second rejected report fails/i);
  assert.doesNotMatch(workflow, /subagent_type: "Comment Sicko"/);
  assert.doesNotMatch(agent, /Yes\.\.\. Ha ha ha/);
});

test("comment inspector freezes scope and emits only final classifications", () => {
  const agent = read("agents/comment-inspector.md");
  const workflow = read("references/no-comments.md");

  assert.match(agent, /freeze the parent-provided scope/i);
  assert.match(agent, /never add files to that scope/i);
  assert.match(agent, /classify each scoped comment exactly once/i);
  assert.match(agent, /do not emit provisional decisions/i);
  assert.match(agent, /no progress narration/i);
  assert.match(agent, /directly covered by the deleted alibi/i);
  assert.match(agent, /do not infer broader architecture work/i);
  assert.match(agent, /report only/i);

  assert.match(workflow, /immutable scope/i);
  assert.match(workflow, /outside that scope/i);
  assert.match(workflow, /provisional or contradictory classifications/i);
});

test("comment inspector is report-only and parent owns workspace mutation", () => {
  const agent = read("agents/comment-inspector.md");
  const workflow = read("references/no-comments.md");

  assert.match(agent, /report-only/i);
  assert.match(agent, /never edit files/i);
  assert.doesNotMatch(agent, /touch comments/i);
  assert.match(workflow, /parent applies accepted comment deletions/i);
  assert.match(workflow, /reviewer failure cannot leave workspace mutations/i);
  assert.match(workflow, /subagent.*error.*parent fallback/i);
});

test("apply vs report, encodings, and merge-ready blockers", () => {
  const workflow = read("references/no-comments.md");
  assert.match(workflow, /push_code/);
  assert.match(workflow, /foreign/i);
  assert.match(workflow, /report-only/i);
  assert.match(workflow, /blocks the review verdict/i);
  assert.match(workflow, /opted-out pass does not run/i);
  assert.match(workflow, /merge-ready blocker/i);
  assert.doesNotMatch(workflow, /Pass still succeeds/);
  assert.match(workflow, /proven innocent/i);
  assert.match(workflow, /Do not encode an alibi/i);
});

test("composed workflows load no-comments then simplify unless opted out", () => {
  for (const path of COMPOSED) {
    const text = read(path);
    assert.match(text, /references\/no-comments\.md/, path);
    assert.match(text, /references\/simplify-pr\.md/, path);
    assert.match(text, /skip no-comments|without simplify|opt(?:s|ed)? out/i, path);
  }
});

test("comment-depth is GitHub posts not source comments", () => {
  const depth = read("references/comment-depth.md");
  assert.match(depth, /GitHub posts/);
  assert.match(depth, /not source comments/i);
});
