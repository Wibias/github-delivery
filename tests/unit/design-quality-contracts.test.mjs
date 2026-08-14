import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("Standards review applies design quality as an advisory evidence-backed lens", () => {
  const designUrl = new URL(
    "../../references/design-quality.md",
    import.meta.url,
  );
  assert.ok(existsSync(designUrl), "expected design-quality companion");

  const design = readFileSync(designUrl, "utf8");
  const standards = read("references/spec-standards-review.md");

  assert.match(design, /advisory design lens/i);
  assert.match(design, /normal use case/i);
  assert.match(design, /owning boundary/i);
  assert.match(design, /compress complexity/i);
  assert.match(design, /domain states and invariants/i);
  assert.match(design, /one clear owner/i);
  assert.match(design, /concurrent actors.*partitioned|partitioned.*concurrent actors/is);
  assert.match(design, /credible security/i);
  assert.match(design, /threat\/failure model/i);
  assert.match(design, /pstack/i);
  assert.match(design, /Hona/i);

  assert.match(standards, /references\/design-quality\.md/);
  assert.match(standards, /advisory/i);
  assert.match(standards, /Repository standards still override it/i);
  assert.match(standards, /design-quality companion was applied where relevant or explicitly recorded `n\/a`/i);
});

test("invalid external data is validated at the owning boundary rather than every layer", () => {
  const bugHunt = read("references/bug-hunt-method.md");

  assert.match(bugHunt, /Boundary-owned defense/i);
  assert.match(bugHunt, /references\/design-quality\.md/);
  assert.match(bugHunt, /Do not duplicate the same validation\s+at every internal layer/i);
  assert.doesNotMatch(
    bugHunt,
    /add\s+validation at every layer the data passes through/i,
  );
});
