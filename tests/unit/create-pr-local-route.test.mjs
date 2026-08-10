import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { routeShippingGithubPrompt } from "../../scripts/lib/skill-router.mjs";
import { validateWorkflowMutationMode } from "../../scripts/lib/workflow-mode.mjs";

test("bare create pr routes to the local-work workflow", () => {
  assert.deepEqual(routeShippingGithubPrompt("create pr"), {
    skill: "github-delivery",
    workflow: "references/create-pr-from-local-work.md",
    mutationMode: "maintainer",
    explicitActions: ["push_code", "create_pr"],
  });
});

test("local change publication wording routes to the local-work workflow", () => {
  for (const prompt of [
    "open a PR for these changes",
    "make a pull request for this work",
  ]) {
    assert.equal(
      routeShippingGithubPrompt(prompt)?.workflow,
      "references/create-pr-from-local-work.md",
    );
  }
});

test("issue-linked create pr keeps the issue workflow", () => {
  assert.equal(
    routeShippingGithubPrompt("create a pr for issue #90")?.workflow,
    "references/create-pr-for-issue.md",
  );
});

test("existing PR references are not mistaken for local PR creation", () => {
  assert.notEqual(
    routeShippingGithubPrompt("open PR #42")?.workflow,
    "references/create-pr-from-local-work.md",
  );
});

test("local-work workflow is maintainer-compatible and declares safety boundaries", () => {
  const workflow = readFileSync(
    new URL("../../references/create-pr-from-local-work.md", import.meta.url),
    "utf8",
  );
  const mode = validateWorkflowMutationMode({
    workflow: "references/create-pr-from-local-work.md",
    mutationMode: "maintainer",
  });

  assert.equal(mode.valid, true);
  assert.match(workflow, /Do not infer an issue/i);
  assert.match(workflow, /Never offer or perform a bypass/i);
  assert.match(workflow, /Do not load `references\/shared-rules\.md` as mandatory context/i);
  assert.doesNotMatch(workflow, /Issue conversation intake/);
});
