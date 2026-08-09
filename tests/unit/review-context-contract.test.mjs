import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const compact = readFileSync(
  new URL("../../references/review-contract-compact.md", import.meta.url),
  "utf8",
);
const manifest = JSON.parse(
  readFileSync(
    new URL("../../references/review-context-manifest.json", import.meta.url),
    "utf8",
  ),
);
const fullReview = readFileSync(
  new URL("../../references/full-review-pr.md", import.meta.url),
  "utf8",
);

const mandatoryCompactMarkers = [
  "## Trust boundary",
  "## Evidence generation",
  "## Mandatory review axes",
  "### Semantic propagation",
  "### Bug review",
  "### Security review",
  "### Spec, standards, and maintainability",
  "## GitHub policy semantics",
  "## Mutation and social-effect rules",
  "## Final verdict completion lock",
  "## Progressive disclosure rule",
  "scripts/verify-verdict-published.mjs",
  "published: true",
  "format.valid: true",
  "Only explicit user cancellation",
];

test("compact review contract retains every mandatory stable axis", () => {
  for (const marker of mandatoryCompactMarkers) {
    assert.ok(compact.includes(marker), `compact contract missing: ${marker}`);
  }
});

test("compact contract stays materially smaller than the full workflow reference", () => {
  assert.ok(Buffer.byteLength(compact, "utf8") < Buffer.byteLength(fullReview, "utf8"));
  assert.ok(Buffer.byteLength(compact, "utf8") <= 14_000);
});

test("context manifest bootstraps compact rules and always retains semantic propagation", () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.bootstrap, "references/review-contract-compact.md");
  assert.ok(manifest.always.includes("references/review-contract-compact.md"));
  assert.ok(manifest.always.includes("references/semantic-propagation-review.md"));
});

test("context manifest keeps detailed methods available by trigger", () => {
  assert.equal(manifest.triggered.bug, "references/bug-review.md");
  assert.equal(manifest.triggered.security, "references/security-review.md");
  assert.equal(manifest.triggered.specStandards, "references/spec-standards-review.md");
  assert.equal(manifest.triggered.publication, "references/comment-depth.md");
  assert.equal(manifest.triggered.mutationAuthority, "references/github-mutation-broker.md");
});

test("token savings may never remove freshness or authority gates", () => {
  const required = new Set(manifest.neverSkipForTokenSavings);
  for (const gate of [
    "exact-head binding",
    "semantic propagation",
    "required checks",
    "effective rules",
    "review threads",
    "mutation authority",
    "final ship-gate recapture",
    "final verdict publication verification",
  ]) {
    assert.ok(required.has(gate), `never-skip gate missing: ${gate}`);
  }
});
