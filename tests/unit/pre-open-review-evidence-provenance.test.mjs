import assert from "node:assert/strict";
import test from "node:test";

import {
  evidenceClears,
  validatePreOpenEvidence,
} from "../../scripts/lib/pre-open-evidence.mjs";

const HEAD = "a".repeat(40);
const STALE = "b".repeat(40);

function done(headSha = HEAD) {
  return {
    status: "done",
    headSha,
    method: "manual-review",
    reviewedFiles: ["src/worker.ts"],
  };
}

test("pre-open review evidence accepts structured current-head provenance", () => {
  const result = validatePreOpenEvidence({
    schemaVersion: 2,
    lenses: { "silent-failures": done() },
    surfaces: { authentication: done() },
    probes: {},
  });

  assert.equal(result.ok, true, result.errors?.join("\n"));
  assert.equal(
    evidenceClears(result.evidence.lenses, "silent-failures", { headSha: HEAD }),
    true,
  );
  assert.equal(
    evidenceClears(result.evidence.surfaces, "authentication", { headSha: HEAD }),
    true,
  );
});

test("bare done strings no longer clear review obligations", () => {
  const result = validatePreOpenEvidence({
    schemaVersion: 2,
    lenses: { "silent-failures": "done" },
    surfaces: { authentication: "done" },
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /structured review evidence/i);
});

test("stale structured evidence cannot clear a current-head obligation", () => {
  const result = validatePreOpenEvidence({
    schemaVersion: 2,
    lenses: { "silent-failures": done(STALE) },
    surfaces: { authentication: done(STALE) },
  });
  assert.equal(result.ok, true, result.errors?.join("\n"));
  assert.equal(
    evidenceClears(result.evidence.lenses, "silent-failures", { headSha: HEAD }),
    false,
  );
  assert.equal(
    evidenceClears(result.evidence.surfaces, "authentication", { headSha: HEAD }),
    false,
  );
});
