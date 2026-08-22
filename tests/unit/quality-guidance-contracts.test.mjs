import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("durable GitHub prose uses the evidence-preserving quality contract", () => {
  const proseUrl = new URL(
    "../../references/prose-quality.md",
    import.meta.url,
  );
  assert.ok(existsSync(proseUrl), "expected prose quality companion");

  const prose = readFileSync(proseUrl, "utf8");
  const publication = read("references/policy/publication.md");
  const issueWorkflows = read("references/issue-workflows.md");
  const prDescription = read("references/pr-description.md");

  assert.match(prose, /## Evidence-preservation rule/);
  assert.match(prose, /unknown.*not run.*blocked/is);
  assert.match(prose, /pstack.*unslop.*technical-writing/is);
  assert.match(prose, /## Publication tells/);
  assert.match(prose, /I hope this helps/);
  assert.match(prose, /I then ran/);
  assert.match(prose, /not just X, but Y/);
  assert.match(prose, /Do not add first person, personality, or "soul\."/);
  assert.match(prose, /Do not score[\s\S]*sounds human/i);
  assert.match(prose, /Do not ban em dashes/);
  assert.match(prose, /type-evidence-review\.md/);
  assert.match(prose, /simplify-pr\.md/);
  assert.match(prose, /Did any publication tell remain/);
  assert.match(prose, /does not import humanizer skills, authenticity scoring/i);
  assert.match(publication, /GD-PUB-009/);
  assert.match(publication, /references\/prose-quality\.md/);
  assert.match(issueWorkflows, /references\/prose-quality\.md/);
  assert.match(prDescription, /references\/prose-quality\.md/);
});

test("bug fixes require regression evidence without forcing low-signal tests", () => {
  const regressionUrl = new URL(
    "../../references/regression-first.md",
    import.meta.url,
  );
  assert.ok(existsSync(regressionUrl), "expected regression-first companion");

  const regression = readFileSync(regressionUrl, "utf8");
  const reviews = read("references/policy/reviews.md");
  const bugHunt = read("references/bug-hunt-method.md");

  assert.match(regression, /narrowest useful regression check/i);
  assert.match(regression, /Do not build a broad harness/i);
  assert.match(regression, /arbitrary test-count targets/i);
  assert.match(reviews, /GD-REVIEW-010/);
  assert.match(reviews, /references\/regression-first\.md/);
  assert.match(bugHunt, /Apply `references\/regression-first\.md`/);
  assert.match(bugHunt, /Size coverage by distinct behavior partitions/i);
  assert.doesNotMatch(bugHunt, /cyclomatic complexity: 1[–-]5/i);
  assert.match(bugHunt, /Skip regression evidence, the fix is obvious/);
});

test("material non-local risk names and proves a safety invariant", () => {
  const invariantUrl = new URL(
    "../../references/safety-invariant.md",
    import.meta.url,
  );
  assert.ok(existsSync(invariantUrl), "expected safety invariant companion");

  const invariant = readFileSync(invariantUrl, "utf8");
  const reviews = read("references/policy/reviews.md");
  const bugHunt = read("references/bug-hunt-method.md");

  assert.match(invariant, /## Proof ladder/);
  assert.match(
    invariant,
    /Claimed[\s\S]*Located[\s\S]*Traced[\s\S]*Executed[\s\S]*Reproduced/,
  );
  assert.match(invariant, /proved \| unproven \| violated/);
  assert.match(invariant, /semantic-propagation-review\.md/);
  assert.match(reviews, /GD-REVIEW-011/);
  assert.match(reviews, /references\/safety-invariant\.md/);
  assert.match(bugHunt, /references\/safety-invariant\.md/);
});
