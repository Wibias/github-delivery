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

test("simplification is composed by default, behavior-preserving, and followed by full re-review", () => {
  const skill = readFileSync(new URL("../../SKILL.md", import.meta.url), "utf8");
  const fullReview = readFileSync(new URL("../../references/full-review-pr.md", import.meta.url), "utf8");
  const simplifyUrl = new URL("../../references/simplify-pr.md", import.meta.url);

  assert.ok(existsSync(simplifyUrl), "expected simplify workflow");
  const simplify = readFileSync(simplifyUrl, "utf8");

  assert.match(skill, /references\/simplify-pr\.md/);
  assert.match(skill, /references\/no-comments\.md/);
  assert.match(skill, /unless the request opts out/i);
  assert.match(skill, /line count.*never/i);
  assert.doesNotMatch(skill, /Simplification is explicit-only/);

  assert.match(fullReview, /references\/no-comments\.md/);
  assert.match(fullReview, /skip no-comments/);
  assert.match(fullReview, /without simplify/);
  assert.match(fullReview, /complete full-review workflow|remaining review/i);
  assert.match(fullReview, /no recursive/i);
  assert.doesNotMatch(fullReview, /Optional simplify phase/);

  assert.match(simplify, /line count is never/i);
  assert.match(simplify, /nothing worth simplifying/i);
  assert.match(simplify, /behavior/i);
  assert.match(simplify, /revert.*individually/i);
  assert.match(simplify, /focused validation/i);
  assert.match(simplify, /required.*gates/i);
  assert.match(simplify, /security/i);
  assert.match(simplify, /push_code/);
  assert.match(simplify, /complete full-review workflow/i);
  assert.match(simplify, /simplification disabled/i);
});

test("simplify candidate pass includes concrete readability and state lenses", () => {
  const simplify = readFileSync(
    new URL("../../references/simplify-pr.md", import.meta.url),
    "utf8",
  );

  assert.match(simplify, /Readability, vocabulary, and state lenses/);
  assert.match(simplify, /one concept has multiple names/i);
  assert.match(simplify, /repeat context already supplied/i);
  assert.match(simplify, /restate visible code/i);
  assert.match(simplify, /non-obvious constraints/i);
  assert.match(simplify, /primary behavior buried beneath low-level helpers/i);
  assert.match(simplify, /safely derivable from an existing authoritative value/i);
  assert.match(simplify, /introduced and superseded entirely within the same unmerged PR/i);
  assert.match(simplify, /without reading the issue, conversation, or commit history/i);
  assert.match(simplify, /existing repository utilities or abstractions/i);

  assert.match(simplify, /candidate signals, not automatic edits/i);
  assert.match(simplify, /established repository or domain term/i);
  assert.match(simplify, /performance, timing, snapshot semantics/i);
  assert.match(simplify, /never shipped, persisted, externally consumed/i);
  assert.match(simplify, /fixtures, generated artifacts, downstream branches, or tests/i);
});

test("foreign PRs receive owner instructions instead of base-sync pushes or simplification edits", () => {
  const shared = readFileSync(new URL("../../references/shared-rules.md", import.meta.url), "utf8");
  const fullReview = readFileSync(new URL("../../references/full-review-pr.md", import.meta.url), "utf8");
  const simplify = readFileSync(new URL("../../references/simplify-pr.md", import.meta.url), "utf8");

  assert.match(shared, /PR ownership boundary/);
  assert.match(shared, /authenticated viewer login/);
  assert.match(shared, /never update the branch from base/);
  assert.match(shared, /never apply simplification changes/);
  assert.match(shared, /Applies to: `fix-pr-bots`, `full-review-pr`, `simplify-pr`, `no-comments`/);

  assert.match(fullReview, /PR ownership boundary/);
  assert.match(fullReview, /do not edit or push/);
  assert.match(fullReview, /for the PR owner/);

  assert.match(simplify, /PR ownership/);
  assert.match(simplify, /delivered to the PR owner/);
  assert.match(simplify, /nothing is applied or pushed/);
});

test("README documents the current public workflows and safety model", () => {
  const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");

  assert.match(readme, /simplify PR #42 without changing behavior/i);
  assert.match(readme, /full review PR #42 and simplify it safely/i);
  assert.match(readme, /full review PR #42 without simplify/i);
  assert.match(readme, /no-comments PR #42/i);
  assert.match(readme, /references\/simplify-pr\.md/);
  assert.match(readme, /references\/no-comments\.md/);
  assert.match(readme, /complete full review/i);
  assert.match(readme, /line count is never/i);
  assert.match(readme, /nothing worth simplifying/i);
  assert.match(readme, /SECURITY\.md/);
  assert.match(readme, /private vulnerability reporting/i);
});
