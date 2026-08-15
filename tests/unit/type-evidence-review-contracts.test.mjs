import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { validateBehaviouralCase } from "../../scripts/lib/behavioural-evals.mjs";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("Standards review loads the type-evidence companion only for relevant typed code", () => {
  const typeEvidenceUrl = new URL(
    "../../references/type-evidence-review.md",
    import.meta.url,
  );
  assert.ok(existsSync(typeEvidenceUrl), "expected type-evidence review companion");

  const typeEvidence = readFileSync(typeEvidenceUrl, "utf8");
  const standards = read("references/spec-standards-review.md");

  assert.match(typeEvidence, /preserve evidence/i);
  assert.match(typeEvidence, /known-value widening/i);
  assert.match(typeEvidence, /widen.*assert|assert.*widen/is);
  assert.match(typeEvidence, /chained assertions/i);
  assert.match(typeEvidence, /untrusted external input/i);
  assert.match(typeEvidence, /unknown.*correct|correct.*unknown/is);
  assert.match(typeEvidence, /module mock/i);
  assert.match(typeEvidence, /comment.*not.*proof|not.*proof.*comment/is);
  assert.match(typeEvidence, /repository standards.*override/i);
  assert.match(typeEvidence, /anti-slop/i);

  assert.match(standards, /references\/type-evidence-review\.md/);
  assert.match(standards, /TypeScript|typed JavaScript/i);
  assert.match(standards, /type-evidence.*`n\/a`|`n\/a`.*type-evidence/is);
});

test("Type-evidence guidance rejects blanket anti-slop rules", () => {
  const typeEvidence = read("references/type-evidence-review.md");

  assert.match(typeEvidence, /Do not ban `unknown`/i);
  assert.match(typeEvidence, /Do not ban `typeof`/i);
  assert.match(typeEvidence, /Do not require a literal `SAFETY:` comment/i);
  assert.match(typeEvidence, /genuinely open dictionaries/i);
  assert.match(typeEvidence, /library interop/i);
});

test("Type-evidence behavioural cases include positive and false-positive controls", () => {
  const cases = JSON.parse(read("tests/evals/behavioural-type-evidence-cases.json"));
  assert.ok(cases.length >= 6, "expected a compact positive/control suite");

  for (const item of cases) validateBehaviouralCase(item);

  const ids = new Set(cases.map((item) => item.id));
  for (const id of [
    "TYPE-EVID-001-chained-assertion",
    "TYPE-EVID-002-boundary-unknown-control",
    "TYPE-EVID-003-known-value-widening",
    "TYPE-EVID-004-interop-assertion-control",
    "TYPE-EVID-005-wiring-mock",
    "TYPE-EVID-006-unit-mock-control",
  ]) {
    assert.ok(ids.has(id), `missing behavioural case ${id}`);
  }

  const boundaryControl = cases.find((item) => item.id === "TYPE-EVID-002-boundary-unknown-control");
  assert.deepEqual(boundaryControl.requiredFindings, []);
  assert.ok(boundaryControl.forbiddenFindings.includes("TYPE-EVID-UNKNOWN-001"));

  const mockControl = cases.find((item) => item.id === "TYPE-EVID-006-unit-mock-control");
  assert.deepEqual(mockControl.requiredFindings, []);
  assert.ok(mockControl.forbiddenFindings.includes("TEST-WIRING-MOCK-001"));
});
