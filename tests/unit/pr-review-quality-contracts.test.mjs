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

  assert.match(triage, /confirmed \| false-positive \| stale \| unproven/);
  assert.match(triage, /must-fix \| worth-fixing \| decline \| human-decision/);
  assert.match(triage, /pinned|shipped version|actual dependency/i);
  assert.match(triage, /executable probe/i);
  assert.match(triage, /taste|style preference/i);
  assert.match(triage, /scope creep/i);
  assert.match(reviews, /review-finding-triage\.md/);
  assert.match(fixBots, /review-finding-triage\.md/);
});

test("full review surfaces code quality and blast radius through canonical review policy", () => {
  const specStandards = read("references/spec-standards-review.md");
  const reviews = read("references/policy/reviews.md");
  const outcome = read("references/review-outcome.md");
  const fullReview = read("references/full-review-pr.md");

  assert.match(specStandards, /Code quality/);
  assert.match(specStandards, /advisory/i);
  assert.match(reviews, /review-outcome\.md/);
  assert.match(fullReview, /Policy modules:[\s\S]*- reviews/);
  assert.match(fullReview, /semantic-propagation-review\.md/);
  assert.match(outcome, /Code quality/);
  assert.match(outcome, /Blast radius/);
  assert.match(outcome, /semantic-propagation-review\.md/);
  assert.match(outcome, /safety-invariant\.md/);
  assert.match(outcome, /local \| non-local/);
  assert.match(outcome, /Executed/);
  assert.match(outcome, /unproven/i);
});

test("re-review approve-comment clears owned stale Request changes before completion", () => {
  const rereview = read("references/re-review-pr.md");

  assert.match(rereview, /planNativeReviewSidecar/);
  assert.match(rereview, /dismiss_review/);
  assert.match(rereview, /re-fetch.*reviews|refresh.*reviews/is);
  assert.match(rereview, /re-run.*ship-gate|refresh.*ship gate/is);
  assert.match(rereview, /approve-comment[\s\S]*must not complete[\s\S]*owned[\s\S]*CHANGES_REQUESTED/i);
  assert.match(rereview, /Never report `Gate: none`[\s\S]*authoritative gate is blocked/i);
});

test("re-review is delta-first and avoids repeated helper-contract discovery", () => {
  const rereview = read("references/re-review-pr.md");

  assert.match(rereview, /review-brief\.mjs/);
  assert.match(rereview, /once per unchanged head/i);
  assert.match(rereview, /do not re-read unchanged/i);
  assert.match(rereview, /do not rediscover.*JSON shapes|never rediscover.*JSON shapes/is);
  assert.match(rereview, /first failure.*stdout|first failure.*stderr/is);
  assert.match(rereview, /specialist-owned analysis/i);
});

test("review-integrity follow-up release is complete in 1.5.2", () => {
  const pkg = JSON.parse(read("package.json"));
  const changelog = read("CHANGELOG.md");
  const release = changelog.split("## [1.5.2] - 2026-09-10")[1]?.split("## [1.5.1]")[0] ?? "";

  assert.ok(release, "expected a dated 1.5.2 changelog section");
  for (const pr of [440, 441, 442, 443, 444, 445, 446]) {
    assert.match(release, new RegExp(`PR #${pr}\\b`));
  }
});

test("re-review trace follow-up release is complete in 1.5.3", () => {
  const pkg = JSON.parse(read("package.json"));
  const changelog = read("CHANGELOG.md");
  const release = changelog.split("## [1.5.3] - 2026-09-10")[1]?.split("## [1.5.2]")[0] ?? "";

  assert.equal(pkg.version, "1.5.3");
  assert.ok(release, "expected a dated 1.5.3 changelog section");
  for (const pr of [448, 449, 450]) {
    assert.match(release, new RegExp(`PR #${pr}\\b`));
  }
});
