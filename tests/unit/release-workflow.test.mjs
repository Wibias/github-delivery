import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { validateWorkflowFile } from "../../scripts/lib/workflow-security.mjs";

const workflow = readFileSync(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8").replace(/\r\n?/g, "\n");
const tagWorkflow = readFileSync(new URL("../../.github/workflows/create-release-tag.yml", import.meta.url), "utf8").replace(/\r\n?/g, "\n");

test("release workflow publishes both pushed tags and tag-dispatched manual runs", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /publish:\n[\s\S]*startsWith\(github\.ref, 'refs\/tags\/v'\)/);
  assert.match(workflow, /github\.event_name == 'push'/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch'/);
});

test("release workflow uses least privilege and pinned actions", () => {
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(workflow, /contents: write\n      id-token: write\n      attestations: write/);
  for (const match of workflow.matchAll(/uses:\s+([^\s#]+)/g)) {
    assert.match(match[1], /@[0-9a-f]{40}$/);
  }
});

test("tag publish verifies protected-main lineage before validation and publication", () => {
  const matches = [...workflow.matchAll(/node scripts\/verify-release-source\.mjs/g)];
  assert.equal(matches.length, 2, "release lineage must be verified in both validate and publish jobs");
  assert.match(workflow, /RELEASE_SOURCE_COMMIT: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /RELEASE_DEFAULT_BRANCH: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.match(workflow, /Verify tagged source belongs to protected main lineage[\s\S]*Run repository checks/);
  assert.match(workflow, /Reverify tagged source belongs to protected main lineage[\s\S]*Rebuild from the tagged commit/);
});

test("tag publish rebuilds, attests, refuses an existing release, and uses changelog notes", () => {
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
  assert.match(workflow, /--notes-file dist\/RELEASE_NOTES\.md/);
});

test("manual tag workflow reads package version, validates before tagging, and dispatches release on that tag", () => {
  assert.match(tagWorkflow, /name: Create Release Tag/);
  assert.match(tagWorkflow, /workflow_dispatch:/);
  assert.match(tagWorkflow, /contents: write/);
  assert.match(tagWorkflow, /actions: write/);
  assert.match(tagWorkflow, /package\.json/);
  assert.match(tagWorkflow, /Run repository checks[\s\S]*Prepare and verify release[\s\S]*Create release tag[\s\S]*Dispatch release workflow on tag/);
  assert.match(tagWorkflow, /git\/refs/);
  assert.match(tagWorkflow, /actions\/workflows\/release\.yml\/dispatches/);
  assert.match(tagWorkflow, /ref="\$\{RELEASE_TAG\}"/);
});

test("manual tag workflow is accepted by repository workflow security", () => {
  const errors = validateWorkflowFile(".github/workflows/create-release-tag.yml", tagWorkflow);
  assert.deepEqual(errors, []);
});

test("workflow security rejects attacker-controlled GitHub data interpolated directly into run", () => {
  for (const run of [
    'run: echo "${{ github.event.pull_request.title }}"',
    'run: echo "${{ github.head_ref }}"',
    'run: |\n          printf "%s\\n" "${{ github.event.comment.body }}"',
  ]) {
    const source = `name: Unsafe\non:\n  pull_request:\npermissions:\n  contents: read\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - ${run}\n`;
    const errors = validateWorkflowFile(".github/workflows/unsafe.yml", source);
    assert.ok(
      errors.some(
        (error) =>
          error.code === "workflow_yaml_unsupported" &&
          /yaml_untrusted_run_expression/.test(error.detail),
      ),
      JSON.stringify(errors),
    );
  }
});

test("workflow security permits untrusted values passed through env instead of expression substitution in run", () => {
  const source = `name: Safe\non:\n  pull_request:\npermissions:\n  contents: read\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - env:\n          PR_TITLE: \${{ github.event.pull_request.title }}\n        run: |\n          printf '%s\\n' "$PR_TITLE"\n`;
  const errors = validateWorkflowFile(".github/workflows/safe.yml", source);
  assert.equal(
    errors.some((error) => /untrusted_run_expression/.test(error.detail || "")),
    false,
    JSON.stringify(errors),
  );
});
