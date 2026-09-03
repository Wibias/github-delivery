import assert from "node:assert/strict";
import test from "node:test";

import { compactPreOpenGateReport } from "../../scripts/pre-open-gate.mjs";

const HEAD = "b".repeat(40);

function blockedReport() {
  return {
    schemaVersion: 1,
    kind: "github-delivery/pre-open-gate",
    repo: "acme/widgets",
    baseRef: "main",
    headRef: "feature/widgets",
    baseRefOid: "a".repeat(40),
    headRefOid: HEAD,
    diffIdentity: "sha256:test",
    fileCount: 2,
    decision: "blocked",
    complete: true,
    implementationDiffPresent: true,
    evidenceApplied: false,
    bugScope: {
      requiredLenses: ["silent_failures", "edge_cases"],
      lensEvidence: {
        silent_failures: { files: ["src/a.ts"], reasons: ["error path changed"] },
        edge_cases: { files: [], reasons: ["baseline complementary review obligation"] },
      },
      logicFilesSample: ["src/a.ts", "src/b.ts"],
      reviewPlan: {
        probeEvidence: {
          "test-honesty": { files: ["src/b.ts"] },
        },
      },
    },
    securityScope: {
      requiredSurfaces: ["authn"],
      matched: {
        authn: { files: ["src/a.ts"], why: "authentication flow changed" },
      },
      reviewPlan: {
        logicFiles: ["src/a.ts", "src/b.ts"],
        probeEvidence: {
          "test-honesty": { files: ["src/b.ts"] },
        },
      },
    },
    requiredProbes: ["test-honesty"],
    probeEvidenceErrors: [{ probeId: "test-honesty", code: "missing" }],
    blockers: [
      "bug:requiredLenses:silent_failures",
      "bug:requiredLenses:edge_cases",
      "security:requiredSurfaces:authn",
      "probe:requiredProbes:test-honesty",
    ],
    clearedByEvidence: [],
  };
}

test("compact pre-open report exposes only authoritative remaining obligations", () => {
  const compact = compactPreOpenGateReport(blockedReport());

  assert.equal(compact.kind, "github-delivery/pre-open-gate-summary");
  assert.equal(compact.decision, "blocked");
  assert.equal(compact.nextAction, "complete_evidence");
  assert.equal(compact.blockerCount, 4);
  assert.equal(Object.hasOwn(compact, "bugScope"), false);
  assert.equal(Object.hasOwn(compact, "securityScope"), false);
  assert.deepEqual(compact.remaining, {
    lenses: ["edge_cases", "silent_failures"],
    surfaces: ["authn"],
    probes: ["test-honesty"],
    other: [],
  });
  assert.equal(compact.evidenceRequirements.schemaVersion, 2);
  assert.equal(compact.evidenceRequirements.headSha, HEAD);
  assert.deepEqual(compact.evidenceRequirements.lenses.silent_failures.reviewedFiles, ["src/a.ts"]);
  assert.deepEqual(compact.evidenceRequirements.lenses.edge_cases.reviewedFiles, ["src/a.ts", "src/b.ts"]);
  assert.deepEqual(compact.evidenceRequirements.surfaces.authn.reviewedFiles, ["src/a.ts"]);
  assert.deepEqual(compact.evidenceRequirements.probes["test-honesty"].files, ["src/b.ts"]);
  assert.equal(Object.hasOwn(compact.evidenceRequirements.lenses.silent_failures, "status"), false);
});

test("ready compact report has one unambiguous publication disposition", () => {
  const report = blockedReport();
  report.decision = "ready";
  report.blockers = [];
  report.probeEvidenceErrors = [];

  const compact = compactPreOpenGateReport(report);
  assert.equal(compact.decision, "ready");
  assert.equal(compact.nextAction, "proceed_to_publication");
  assert.equal(compact.blockerCount, 0);
  assert.deepEqual(compact.remaining, { lenses: [], surfaces: [], probes: [], other: [] });
});
