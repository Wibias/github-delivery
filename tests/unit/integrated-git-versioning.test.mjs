import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  PUBLIC_ROUTE_HANDOFFS,
  ROUTABLE_WORKFLOWS,
} from "../../scripts/lib/skill-router.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function read(path) {
  return readFileSync(resolve(ROOT, path), "utf8");
}

test("github-delivery owns git workflow and release versioning instead of handing them off", () => {
  assert.equal(PUBLIC_ROUTE_HANDOFFS.includes("git-workflow-and-versioning"), false);
  assert.ok(ROUTABLE_WORKFLOWS.includes("references/git-workflow.md"));
  assert.ok(ROUTABLE_WORKFLOWS.includes("references/versioning-release.md"));

  for (const path of ["references/git-workflow.md", "references/versioning-release.md"]) {
    assert.equal(existsSync(resolve(ROOT, path)), true, path);
  }

  const skill = read("SKILL.md");
  assert.doesNotMatch(skill, /Hand off to skill `git-workflow-and-versioning`/);
  assert.match(skill, /references\/git-workflow\.md/);
  assert.match(skill, /references\/versioning-release\.md/);
});

test("integrated guidance preserves github-delivery safety and repository-local conventions", () => {
  const gitWorkflow = read("references/git-workflow.md");
  const versioning = read("references/versioning-release.md");

  assert.match(gitWorkflow, /repository(?:'s)? existing conventions/i);
  assert.match(gitWorkflow, /unrelated user work/i);
  assert.match(gitWorkflow, /atomic/i);
  assert.match(gitWorkflow, /generated/i);
  assert.doesNotMatch(gitWorkflow, /git reset --hard HEAD\s+takes you back/i);

  assert.match(versioning, /MAJOR/i);
  assert.match(versioning, /MINOR/i);
  assert.match(versioning, /PATCH/i);
  assert.match(versioning, /consumer/i);
  assert.match(versioning, /changelog/i);
  assert.match(versioning, /explicit.*(?:tag|release).*author/i);
});
