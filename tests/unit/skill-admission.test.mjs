import assert from "node:assert/strict";
import test from "node:test";

import { planSkillAdmission } from "../../scripts/lib/skill-admission.mjs";

function base(overrides = {}) {
  return {
    source: "https://github.com/acme/useful-skill",
    commitSha: "a".repeat(40),
    contentSha256: "b".repeat(64),
    license: "MIT",
    declaredCapabilities: {
      scripts: false,
      network: false,
      credentials: false,
      externalTools: false,
      githubWrite: false,
    },
    scans: [],
    validatedFindings: [],
    ...overrides,
  };
}

test("missing immutable identity blocks admission", () => {
  const result = planSkillAdmission(base({ commitSha: null }));
  assert.equal(result.decision, "blocked");
  assert.ok(result.blockers.includes("immutable-commit-required"));
});

test("popularity metadata is ignored as trust evidence", () => {
  const low = planSkillAdmission(base({ popularity: { installs: 1 } }));
  const high = planSkillAdmission(base({ popularity: { installs: 10_000_000, stars: 100_000 } }));
  assert.equal(low.riskTier, high.riskTier);
  assert.equal(low.decision, high.decision);
  assert.equal(high.installAuthorized, false);
});

test("a clean scanner result never becomes trusted or install authority", () => {
  const result = planSkillAdmission(base({
    declaredCapabilities: { scripts: true, network: false, credentials: false, externalTools: false, githubWrite: false },
    scans: [{ kind: "static", tool: "scanner-a", status: "clean" }],
  }));

  assert.equal(result.riskTier, "medium");
  assert.equal(result.decision, "eligible-for-human-review");
  assert.equal(result.trusted, false);
  assert.equal(result.installAuthorized, false);
});

test("high-risk skills require provenance, static and semantic scans, containment, and approval", () => {
  const result = planSkillAdmission(base({
    declaredCapabilities: { scripts: true, network: true, credentials: true, externalTools: true, githubWrite: true },
    scans: [{ kind: "static", tool: "scanner-a", status: "clean" }],
  }));

  assert.equal(result.riskTier, "high");
  assert.equal(result.decision, "needs-review");
  assert.ok(result.missingControls.includes("semantic-scan"));
  assert.ok(result.missingControls.includes("runtime-containment"));
  assert.ok(result.missingControls.includes("provenance"));
  assert.ok(result.missingControls.includes("human-approval"));
});

test("high-risk controls can make a skill eligible but never implicitly trusted", () => {
  const result = planSkillAdmission(base({
    declaredCapabilities: { scripts: true, network: true, credentials: true, externalTools: true, githubWrite: true },
    scans: [
      { kind: "static", tool: "scanner-a", status: "clean" },
      { kind: "semantic", tool: "scanner-b", status: "clean" },
    ],
    provenance: { kind: "signed", ref: "sigstore-bundle" },
    runtimeContainment: { sandbox: "isolated", network: "allowlisted", credentials: "none-during-test" },
    humanApproval: { approved: true, scope: "review/install candidate" },
  }));

  assert.equal(result.decision, "eligible-for-human-review");
  assert.deepEqual(result.missingControls, []);
  assert.equal(result.trusted, false);
  assert.equal(result.installAuthorized, false);
});

test("scanner findings remain leads rather than automatic proof", () => {
  const result = planSkillAdmission(base({
    declaredCapabilities: { scripts: true, network: false, credentials: false, externalTools: false, githubWrite: false },
    scans: [{ kind: "static", tool: "scanner-a", status: "findings", findings: ["suspicious-shell"] }],
  }));

  assert.equal(result.decision, "needs-review");
  assert.deepEqual(result.scannerLeads, [{ tool: "scanner-a", kind: "static", finding: "suspicious-shell" }]);
  assert.equal(result.blockers.length, 0);
});

test("validated high or critical malicious findings block admission", () => {
  const result = planSkillAdmission(base({
    validatedFindings: [{ id: "SKILL-1", severity: "high", verdict: "confirmed", claim: "credential exfiltration" }],
  }));

  assert.equal(result.decision, "blocked");
  assert.ok(result.blockers.some((item) => item.includes("SKILL-1")));
});

test("undeclared capability model fails closed", () => {
  const result = planSkillAdmission(base({ declaredCapabilities: null }));
  assert.equal(result.decision, "blocked");
  assert.ok(result.blockers.includes("declared-capabilities-required"));
});
