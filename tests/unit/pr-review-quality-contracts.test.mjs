import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("PR title and body policy prefers concise outcome-focused publication", () => {
  const prDescription = read("references/pr-description.md");
  const defaultTemplate = prDescription.split("## Default template")[1]?.split("## Media preservation invariant")[0] ?? "";

  assert.match(prDescription, /recent merged PRs/i);
  assert.match(prDescription, /Git history/i);
  assert.match(prDescription, /problem|context/i);
  assert.match(prDescription, /resulting effect|why it matters/i);
  assert.match(prDescription, /Mermaid/i);
  assert.match(prDescription, /before.*after/is);
  assert.match(prDescription, /benchmark/i);
  assert.doesNotMatch(defaultTemplate, /## Validation/);
  assert.doesNotMatch(defaultTemplate, /exact head|HEAD SHA|TDD/i);
  assert.match(prDescription, /draft-only|draft only/i);
});

test("bot findings separate truth from action before code changes", () => {
  const triageUrl = new URL(
    "../../references/review-finding-triage.md",
    import.meta.url,
  );
  assert.ok(existsSync(triageUrl), "expected review finding triage companion");

  const triage = readFileSync(triageUrl, "utf8");
  const reviews = read("references/policy/reviews.md");
  const fixBots = read("references/fix-pr-bots.md");
  const fullReview = read("references/full-review-pr.md");

  assert.match(triage, /confirmed \| false-positive \| stale \| unproven/);
  assert.match(triage, /must-fix \| worth-fixing \| decline \| human-decision/);
  assert.match(triage, /pinned|shipped version|actual dependency/i);
  assert.match(triage, /executable probe/i);
  assert.match(triage, /taste|style preference/i);
  assert.match(triage, /scope creep/i);
  assert.match(reviews, /review-finding-triage\.md/);
  assert.match(fixBots, /review-finding-triage\.md/);
  assert.match(fullReview, /review-finding-triage\.md/);
});

test("full review surfaces code quality and blast radius without new review engines", () => {
  const specStandards = read("references/spec-standards-review.md");
  const fullReview = read("references/full-review-pr.md");
  const commentDepth = read("references/comment-depth.md");

  assert.match(specStandards, /Code quality/);
  assert.match(specStandards, /advisory/i);
  assert.match(fullReview, /Code quality/);
  assert.match(fullReview, /Blast radius/);
  assert.match(fullReview, /semantic-propagation-review\.md/);
  assert.match(fullReview, /safety-invariant\.md/);
  assert.match(fullReview, /local \| non-local|local.*non-local/is);
  assert.match(fullReview, /unproven/i);
  assert.match(commentDepth, /Code quality/);
  assert.match(commentDepth, /Blast radius/);
});

test("PR review quality follow-up stays inside unreleased 1.4.7", () => {
  const pkg = JSON.parse(read("package.json"));
  const changelog = read("CHANGELOG.md");

  assert.equal(pkg.version, "1.4.7");
  assert.equal((changelog.match(/## \[1\.4\.7\]/g) ?? []).length, 1);
});
