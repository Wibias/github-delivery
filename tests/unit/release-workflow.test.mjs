import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8").replace(/\r\n?/g, "\n");

test("release workflow keeps manual runs non-publishing", () => {
  assert.match(workflow, /publish:\n[\s\S]*if: github\.event_name == 'push'/);
  assert.match(workflow, /workflow_dispatch:/);
});

test("release workflow uses least privilege and pinned actions", () => {
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(workflow, /contents: write\n      id-token: write\n      attestations: write/);
  for (const match of workflow.matchAll(/uses:\s+([^\s#]+)/g)) {
    assert.match(match[1], /@[0-9a-f]{40}$/);
  }
});

test("tag publish rebuilds, attests, and refuses an existing release", () => {
  assert.match(workflow, /Rebuild from the tagged commit/);

  const provenanceAttest = workflow.match(
    /- name: Attest release provenance\n\s+uses: actions\/attest@([0-9a-f]{40})/,
  );
  const sbomAttest = workflow.match(
    /- name: Attest release SBOM\n\s+uses: actions\/attest@([0-9a-f]{40})/,
  );
  assert.ok(provenanceAttest, "expected a pinned provenance attestation step");
  assert.ok(sbomAttest, "expected a pinned SBOM attestation step");
  assert.equal(
    sbomAttest[1],
    provenanceAttest[1],
    "attestation steps must use the same action commit",
  );

  assert.match(workflow, /gh release view/);
  assert.match(workflow, /--verify-tag/);
});
