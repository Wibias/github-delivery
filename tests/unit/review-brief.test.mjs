import assert from "node:assert/strict";
import test from "node:test";

import {
  briefText,
  hunkLines,
  normalizeFile,
} from "../../scripts/review-brief.mjs";
import {
  extractProbeBlock,
  extractRequiredProbeBlocks,
  probeMarkers,
} from "../../scripts/lib/probe-blocks.mjs";

test("hunkLines caps long patches and reports truncation", () => {
  const patch = Array.from({ length: 30 }, (_, i) => `+line${i}`).join("\n");
  const result = hunkLines(patch, 10);
  assert.equal(result.text.split("\n").length, 10);
  assert.equal(result.truncated, true);
  assert.equal(result.totalLines, 30);
});

test("hunkLines does not truncate short patches", () => {
  const result = hunkLines("+a\n+b", 10);
  assert.equal(result.truncated, false);
  assert.equal(result.text, "+a\n+b");
});

test("normalizeFile handles GitHub filename field", () => {
  const file = normalizeFile({ filename: "src/x.ts", additions: 3, deletions: 1, patch: "+x" });
  assert.equal(file.path, "src/x.ts");
  assert.equal(file.additions, 3);
  assert.equal(file.deletions, 1);
  assert.equal(file.patch, "+x");
});

test("normalizeFile falls back to unknown for missing path", () => {
  const file = normalizeFile({});
  assert.equal(file.path, "unknown");
});

test("briefText lists lenses, surfaces, and file hunks", () => {
  const text = briefText({
    meta: { repo: "acme/widget", pr: 7 },
    plan: {
      fileCount: 1,
      logicFiles: ["src/x.ts"],
      headRefOid: "abc123",
      requiredProbes: ["credential-transport"],
      dependencyChanges: [],
      removedControlLeads: [],
      uncertainty: [],
    },
    files: [{ path: "src/x.ts", patch: "+const y = 1;", additions: 1, deletions: 0 }],
    bugScope: { requiredLenses: ["silent_failures", "edge_cases"] },
    securityScope: { requiredSurfaces: ["authn", "injection"] },
    maxHunkLines: 24,
  });
  assert.match(text, /acme\/widget#7/);
  assert.match(text, /silent_failures/);
  assert.match(text, /authn/);
  assert.match(text, /credential-transport/);
  assert.match(text, /src\/x\.ts/);
  assert.match(text, /const y = 1/);
});

test("probeMarkers finds tagged probe blocks in a reference doc", () => {
  const source = [
    "# Bug review",
    "<!-- probe: input-shape-evidence-semantics -->",
    "Check real shapes.",
    "#### Must probe — determinism",
    "<!-- probe: determinism-clocks-budgets -->",
    "One clock.",
  ].join("\n");
  const markers = probeMarkers(source);
  assert.deepEqual(
    markers.map((m) => m.id),
    ["input-shape-evidence-semantics", "determinism-clocks-budgets"],
  );
});

test("extractProbeBlock returns the block up to the next heading or marker", () => {
  const source = [
    "# Bug review",
    "<!-- probe: input-shape-evidence-semantics -->",
    "Check real shapes.",
    "",
    "#### Must probe — determinism",
    "<!-- probe: determinism-clocks-budgets -->",
    "One clock.",
  ].join("\n");
  const block = extractProbeBlock(source, "input-shape-evidence-semantics");
  assert.equal(block.found, true);
  assert.match(block.text, /Check real shapes/);
  assert.doesNotMatch(block.text, /One clock/);
  assert.doesNotMatch(block.text, /Must probe — determinism/);
});

test("extractProbeBlock returns null for an unknown probe id", () => {
  const block = extractProbeBlock("# x", "no-such-probe");
  assert.equal(block, null);
});

test("extractRequiredProbeBlocks pulls real blocks from the bundled references", () => {
  const blocks = extractRequiredProbeBlocks([
    { id: "input-shape-evidence-semantics", axis: "bug" },
    { id: "credential-transport", axis: "security" },
  ]);
  assert.equal(blocks.length, 2);
  const bug = blocks.find((b) => b.id === "input-shape-evidence-semantics");
  const sec = blocks.find((b) => b.id === "credential-transport");
  assert.equal(bug.axis, "bug");
  assert.equal(bug.doc, "bug-review.md");
  assert.ok(bug.text.length > 100);
  assert.equal(sec.axis, "security");
  assert.equal(sec.doc, "security-review.md");
  assert.ok(sec.text.length > 50);
});

test("briefText renders required probe blocks", () => {
  const text = briefText({
    meta: { repo: "acme/widget", pr: 7 },
    plan: { fileCount: 0, logicFiles: [], headRefOid: "abc", requiredProbes: [], dependencyChanges: [], removedControlLeads: [], uncertainty: [] },
    files: [],
    bugScope: { requiredLenses: [] },
    securityScope: { requiredSurfaces: [] },
    maxHunkLines: 24,
    probeBlocks: [{ id: "credential-transport", doc: "security-review.md", startLine: 158, endLine: 176, text: "Check credential transport." }],
  });
  assert.match(text, /Required probe blocks/);
  assert.match(text, /credential-transport/);
  assert.match(text, /Check credential transport/);
});

test("review brief labels mechanical files and moved code", () => {
  const text = briefText({
    meta: { repo: "Wibias/github-delivery", pr: 1 },
    plan: {
      fileCount: 2,
      logicFiles: ["scripts/lib/example.mjs"],
      headRefOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      requiredProbes: [],
      dependencyChanges: [],
      removedControlLeads: [],
      uncertainty: [],
    },
    files: [
      {
        path: "package-lock.json",
        additions: 2,
        deletions: 1,
        patch: "@@ -1,2 +1,3 @@\n {\n+  \"lockfileVersion\": 3\n",
      },
      {
        path: "scripts/lib/example.mjs",
        additions: 3,
        deletions: 3,
        patch: [
          "@@ -1,8 +1,8 @@",
          " keep",
          "-alpha",
          "-bravo",
          "-charlie",
          " middle",
          "+alpha",
          "+bravo",
          "+charlie",
          " after",
        ].join("\n"),
      },
    ],
    bugScope: { requiredLenses: [] },
    securityScope: { requiredSurfaces: [] },
  });
  assert.match(text, /package-lock\.json.*mechanical/i);
  assert.match(text, /example\.mjs.*core/i);
  assert.match(text, /moved code: 3 lines/i);
});
