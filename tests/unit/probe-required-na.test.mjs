import assert from "node:assert/strict";
import test from "node:test";

import {
  validateProbeEvidence,
  validateProbeEvidenceRecord,
} from "../../scripts/lib/probe-evidence.mjs";

test("required probe with trigger files cannot be dismissed as n-a", () => {
  const errors = validateProbeEvidenceRecord(
    {
      probeId: "api-cli-wiring",
      status: "n-a",
      reason: "skip this probe",
    },
    {
      required: true,
      triggerFiles: ["scripts/example.mjs"],
    },
  );
  assert.ok(errors.some((error) => error.code === "evidence_required_probe_cannot_be_na"));
});

test("full coverage validation rejects n-a for a deterministically required probe", () => {
  const scope = {
    requiredProbes: ["api-cli-wiring"],
    probeEvidence: {
      "api-cli-wiring": { files: ["scripts/example.mjs"] },
    },
  };
  const errors = validateProbeEvidence(
    {
      "api-cli-wiring": {
        status: "n-a",
        reason: "surface unchanged",
      },
    },
    scope,
  );
  assert.ok(errors.some((error) => error.code === "evidence_required_probe_cannot_be_na"));
});

test("n-a remains valid only when deterministic scope has no trigger files", () => {
  const errors = validateProbeEvidenceRecord(
    {
      probeId: "api-cli-wiring",
      status: "n-a",
      reason: "scope has no trigger files",
    },
    {
      required: true,
      triggerFiles: [],
    },
  );
  assert.deepEqual(errors, []);
});
