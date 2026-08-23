import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("verification chooses the narrowest stable boundary that observes behavior", () => {
  const boundaryUrl = new URL(
    "../../references/verification-boundaries.md",
    import.meta.url,
  );
  assert.ok(existsSync(boundaryUrl), "expected verification-boundaries companion");

  const boundary = readFileSync(boundaryUrl, "utf8");

  assert.match(boundary, /narrowest stable boundary/i);
  assert.match(boundary, /would fail if the protected behavior were actually broken/i);
  assert.match(boundary, /Prefer behavior over implementation shape/i);
  assert.match(boundary, /Use real paths without forcing giant end-to-end tests/i);
  assert.match(boundary, /same shell and PATH/i);
  assert.match(boundary, /Preserve observable order when order matters/i);
  assert.match(boundary, /Characterization before refactor/i);
  assert.match(boundary, /mock choreography/i);
  assert.match(boundary, /Hona/i);
});

test("regression-first no longer hard-codes unit tests above more representative boundaries", () => {
  const regression = read("references/regression-first.md");

  assert.match(regression, /references\/verification-boundaries\.md/);
  assert.match(regression, /narrowest stable boundary that directly demonstrates the defect/i);
  assert.match(regression, /not a fixed test-level hierarchy/i);
  assert.match(regression, /helper-level test.*real use case remains broken/is);
  assert.match(regression, /stable boundary and observable behavior it protects/i);
  assert.doesNotMatch(regression, /Prefer, in order:\s*\n\s*1\. a focused unit or component test/i);
});

test("refactor equivalence prefers stable behavior boundaries without changing the card schema", () => {
  const card = read("references/refactor-contract-card.md");

  assert.match(card, /references\/verification-boundaries\.md/);
  assert.match(card, /private-helper-level check is not strong equivalence evidence/i);
  assert.match(card, /real integration seam/i);
  assert.match(card, /stable behavior boundary that survives the planned restructuring/i);
  assert.match(card, /"wouldFailIfBroken": true/);
});
