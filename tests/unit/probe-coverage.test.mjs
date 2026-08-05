import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { validateProbeEvidence, validateProbeEvidenceRecord } from "../../scripts/lib/probe-evidence.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const COMMAND = join(ROOT, "scripts", "verify-probe-coverage.mjs");

// A scope projection shaped like projectBugScope output for an OAuth baseUrl
// diff: credential-transport fires on the oauth adapter file.
function oauthScope() {
  return {
    requiredProbes: ["credential-transport", "secrets-scan"],
    probeEvidence: {
      "credential-transport": { files: ["src/providers/oauth.ts"] },
      "secrets-scan": { files: ["src/client.ts"] },
    },
  };
}

function writeJson(data) {
  const directory = mkdtempSync(join(tmpdir(), "github-delivery-probe-"));
  const path = join(directory, "data.json");
  writeFileSync(path, JSON.stringify(data), "utf8");
  return path;
}

function runVerify(scope, evidence) {
  return spawnSync("node", [COMMAND, "--scope-file", writeJson(scope), "--evidence-inline", JSON.stringify(evidence)], {
    encoding: "utf8",
  });
}

test("accepts complete clean evidence for every required probe", () => {
  const result = runVerify(oauthScope(), {
    "credential-transport": { status: "clean", files: ["src/providers/oauth.ts"] },
    "secrets-scan": { status: "clean", files: ["src/client.ts"] },
  });
  assert.equal(result.status, 0, result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.valid, true);
});

test("accepts findings evidence with files on trigger files", () => {
  const result = runVerify(oauthScope(), {
    "credential-transport": { status: "findings", files: ["src/providers/oauth.ts"] },
    "secrets-scan": { status: "clean", files: ["src/client.ts"] },
  });
  assert.equal(result.status, 0, result.stdout);
  assert.equal(JSON.parse(result.stdout).valid, true);
});

test("accepts n-a evidence with a reason", () => {
  const result = runVerify(oauthScope(), {
    "credential-transport": { status: "n-a", reason: "baseUrl validator already enforces https for every credential-bearing adapter" },
    "secrets-scan": { status: "clean", files: ["src/client.ts"] },
  });
  assert.equal(result.status, 0, result.stdout);
  assert.equal(JSON.parse(result.stdout).valid, true);
});

test("fails when a required probe has no evidence", () => {
  const result = runVerify(oauthScope(), {
    "credential-transport": { status: "clean", files: ["src/providers/oauth.ts"] },
  });
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.ok(report.errors.some((e) => e.code === "probe_evidence_missing" && e.probeId === "secrets-scan"));
});

test("fails when evidence names an unknown probe", () => {
  const result = runVerify(oauthScope(), {
    "credential-transport": { status: "clean", files: ["src/providers/oauth.ts"] },
    "secrets-scan": { status: "clean", files: ["src/client.ts"] },
    "made-up-probe": { status: "clean", files: ["x.ts"] },
  });
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.ok(report.errors.some((e) => e.code === "probe_evidence_not_required" && e.probeId === "made-up-probe"));
});

test("fails when n-a evidence lacks a reason", () => {
  const result = runVerify(oauthScope(), {
    "credential-transport": { status: "n-a" },
    "secrets-scan": { status: "clean", files: ["src/client.ts"] },
  });
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.ok(report.errors.some((e) => e.code === "evidence_na_requires_reason"));
});

test("fails when findings evidence lists a file outside the probe trigger set", () => {
  const result = runVerify(oauthScope(), {
    "credential-transport": { status: "findings", files: ["src/unrelated.ts"] },
    "secrets-scan": { status: "clean", files: ["src/client.ts"] },
  });
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.ok(report.errors.some((e) => e.code === "evidence_file_not_trigger_file"));
});

test("fails when findings evidence lists no files", () => {
  const result = runVerify(oauthScope(), {
    "credential-transport": { status: "findings", files: [] },
    "secrets-scan": { status: "clean", files: ["src/client.ts"] },
  });
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.ok(report.errors.some((e) => e.code === "evidence_findings_require_files"));
});

test("fails when evidence has an invalid status", () => {
  const result = runVerify(oauthScope(), {
    "credential-transport": { status: "maybe" },
    "secrets-scan": { status: "clean", files: ["src/client.ts"] },
  });
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.ok(report.errors.some((e) => e.code === "evidence_invalid_status"));
});

test("a scope with no required probes and no evidence is vacuously valid", () => {
  const result = spawnSync("node", [COMMAND, "--scope-file", writeJson({ broken: true }), "--evidence-inline", "{}"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.valid, true);
});

test("fails with exit 2 on unreadable file", () => {
  const result = spawnSync("node", [COMMAND, "--scope-file", "no-such-file.json", "--evidence-inline", "{}"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
});

test("unit record validation rejects non-object and missing probe id", () => {
  const errors = validateProbeEvidenceRecord(null, { triggerFiles: ["a.ts"] });
  assert.ok(errors.some((e) => e.code === "evidence_not_object"));
  const missingId = validateProbeEvidenceRecord({ status: "clean", files: ["a.ts"] }, { triggerFiles: ["a.ts"] });
  assert.ok(missingId.some((e) => e.code === "evidence_missing_probe_id"));
});
