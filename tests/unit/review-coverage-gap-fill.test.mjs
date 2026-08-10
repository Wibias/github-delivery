import assert from "node:assert/strict";
import test from "node:test";

import { planCoverageGapFill } from "../../scripts/lib/review-coverage-gap-fill.mjs";

test("targets only uncovered required cells", () => {
  const result = planCoverageGapFill({
    files: ["src/a.mjs", "src/b.mjs"],
    required: {
      bugLenses: ["edge_cases"],
      securitySurfaces: ["authz"],
      probes: ["removed-controls"],
    },
    evidence: [
      { axis: "bug", kind: "lens", id: "edge_cases", file: "src/a.mjs", status: "done" },
      { axis: "security", kind: "surface", id: "authz", file: "src/a.mjs", status: "done" },
      { axis: "security", kind: "probe", id: "removed-controls", file: "src/a.mjs", status: "clean" },
    ],
  });

  assert.deepEqual(result.targets.map((item) => [item.file, item.kind, item.id]), [
    ["src/b.mjs", "lens", "edge_cases"],
    ["src/b.mjs", "surface", "authz"],
    ["src/b.mjs", "probe", "removed-controls"],
  ]);
  assert.equal(result.complete, false);
});

test("does not rescan completed cells just to add another reviewer", () => {
  const result = planCoverageGapFill({
    files: ["src/a.mjs"],
    required: { bugLenses: ["edge_cases"], securitySurfaces: [], probes: [] },
    evidence: [
      { axis: "bug", kind: "lens", id: "edge_cases", file: "src/a.mjs", status: "done", producer: "finder-a" },
    ],
    availableReviewers: ["finder-b", "finder-c"],
  });

  assert.deepEqual(result.targets, []);
  assert.equal(result.complete, true);
  assert.equal(result.instructions.some((line) => line.includes("reviewer count")), true);
});

test("manual and unreviewed evidence stay open", () => {
  const result = planCoverageGapFill({
    files: ["src/a.mjs"],
    required: { bugLenses: ["edge_cases"], securitySurfaces: ["authz"], probes: [] },
    evidence: [
      { axis: "bug", kind: "lens", id: "edge_cases", file: "src/a.mjs", status: "manual-review" },
      { axis: "security", kind: "surface", id: "authz", file: "src/a.mjs", status: "unreviewed" },
    ],
  });

  assert.equal(result.targets.length, 2);
  assert.ok(result.targets.every((item) => item.reason.includes("unresolved")));
});

test("n-a closes a cell only with a concrete reason", () => {
  const good = planCoverageGapFill({
    files: ["src/a.mjs"],
    required: { bugLenses: [], securitySurfaces: ["authz"], probes: [] },
    evidence: [{ axis: "security", kind: "surface", id: "authz", file: "src/a.mjs", status: "n-a", reason: "file only contains generated constants" }],
  });
  assert.equal(good.complete, true);

  const bad = planCoverageGapFill({
    files: ["src/a.mjs"],
    required: { bugLenses: [], securitySurfaces: ["authz"], probes: [] },
    evidence: [{ axis: "security", kind: "surface", id: "authz", file: "src/a.mjs", status: "n-a" }],
  });
  assert.equal(bad.complete, false);
  assert.equal(bad.targets[0].reason, "invalid n-a evidence: concrete reason required");
});

test("explicit file scoping prevents Cartesian expansion to irrelevant files", () => {
  const result = planCoverageGapFill({
    files: ["src/auth.mjs", "docs/readme.md"],
    required: {
      bugLenses: [{ id: "edge_cases", files: ["src/auth.mjs"] }],
      securitySurfaces: [{ id: "authz", files: ["src/auth.mjs"] }],
      probes: [],
    },
    evidence: [],
  });

  assert.deepEqual([...new Set(result.targets.map((item) => item.file))], ["src/auth.mjs"]);
});
