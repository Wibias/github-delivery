import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { routeShippingGithubPrompt } from "../../scripts/lib/skill-router.mjs";

test("routes standalone simplify while keeping combined full review authoritative", () => {
  const standalone = routeShippingGithubPrompt("simplify PR #42 without changing behavior");
  assert.equal(standalone.workflow, "references/simplify-pr.md");
  assert.equal(standalone.mutationMode, "maintainer");

  const combined = routeShippingGithubPrompt("full review PR #42 and simplify it safely");
  assert.equal(combined.workflow, "references/full-review-pr.md");
  assert.equal(combined.mutationMode, "maintainer");
});

test("simplification is explicit, behavior-preserving, and followed by full re-review", () => {
  const skill = readFileSync(new URL("../../SKILL.md", import.meta.url), "utf8");
  const fullReview = readFileSync(new URL("../../references/full-review-pr.md", import.meta.url), "utf8");
  const simplifyUrl = new URL("../../references/simplify-pr.md", import.meta.url);

  assert.ok(existsSync(simplifyUrl), "expected simplify workflow");
  const simplify = readFileSync(simplifyUrl, "utf8");

  assert.match(skill, /references\/simplify-pr\.md/);
  assert.match(skill, /explicit[- ]only/i);
  assert.match(skill, /line count.*never/i);

  assert.match(fullReview, /explicitly asks/i);
  assert.match(fullReview, /explicit approval/i);
  assert.match(fullReview, /complete full-review workflow/i);
  assert.match(fullReview, /post-simplification head/i);
  assert.match(fullReview, /no recursive simplification/i);
  assert.match(fullReview, /no second continuation prompt/i);

  assert.match(simplify, /line count is never/i);
  assert.match(simplify, /nothing worth simplifying/i);
  assert.match(simplify, /behavior/i);
  assert.match(simplify, /revert.*individually/i);
  assert.match(simplify, /focused validation/i);
  assert.match(simplify, /required.*gates/i);
  assert.match(simplify, /security/i);
  assert.match(simplify, /explicit approval/i);
  assert.match(simplify, /complete full-review workflow/i);
  assert.match(simplify, /simplification disabled/i);
});
