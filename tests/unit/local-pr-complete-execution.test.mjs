import assert from "node:assert/strict";
import test from "node:test";

import * as hygieneEvidence from "../../scripts/lib/pre-open-hygiene-evidence.mjs";
import * as preOpenEvidence from "../../scripts/lib/pre-open-evidence.mjs";
import { evaluateCodexHook } from "../../scripts/lib/codex-watchdog-hook.mjs";
import { executionContractForWorkflow } from "../../scripts/lib/workflow-execution-contract.mjs";

const HEAD = "b".repeat(40);

function compactSummary() {
  return {
    schemaVersion: 1,
    kind: "github-delivery/pre-open-gate-summary",
    headRefOid: HEAD,
    remaining: {
      lenses: ["edge_cases", "ui_accessibility"],
      surfaces: ["authn", "injection"],
      probes: ["ui-accessibility"],
      other: [],
    },
    evidenceRequirements: {
      schemaVersion: 2,
      headSha: HEAD,
      lenses: {
        edge_cases: { reviewedFiles: ["src/ui.ts"] },
        ui_accessibility: { reviewedFiles: ["src/ui.ts", "src/a11y.ts"] },
      },
      surfaces: {
        authn: { reviewedFiles: ["src/session.ts"] },
        injection: { reviewedFiles: ["src/ui.ts"] },
      },
      probes: {
        "ui-accessibility": { files: ["src/ui.ts"] },
      },
    },
  };
}

test("local PR execution contract exposes the deterministic hygiene and aggregated evidence helpers", () => {
  const contract = executionContractForWorkflow("create-pr-from-local-work");
  assert.equal(contract.helpers.hygieneOrchestrator, "scripts/create-pr-hygiene.mjs");
  assert.equal(contract.helpers.preOpenEvidenceAssembler, "scripts/pre-open-review-evidence.mjs");
  assert.equal(contract.workflowPlan.hygiene.orchestrator, "scripts/create-pr-hygiene.mjs");
  assert.equal(contract.workflowPlan.preOpen.evidenceAssembler, "scripts/pre-open-review-evidence.mjs");
  assert.equal(contract.workflowPlan.publication.directWriteGuard, "runtime-after-workflow-selection");
});

test("one bug review and one security review expand into current schema-v2 evidence", () => {
  assert.equal(typeof preOpenEvidence.expandAggregatePreOpenEvidence, "function");
  const output = preOpenEvidence.expandAggregatePreOpenEvidence(compactSummary(), {
    schemaVersion: 1,
    kind: "github-delivery/pre-open-review-result",
    headSha: HEAD,
    bug: {
      status: "clean",
      method: "focused candidate bug review",
      reviewedFiles: ["src/ui.ts", "src/a11y.ts"],
    },
    security: {
      status: "clean",
      method: "focused candidate security review",
      reviewedFiles: ["src/session.ts", "src/ui.ts"],
    },
    probes: {
      "ui-accessibility": {
        probeId: "ui-accessibility",
        status: "clean",
        files: ["src/ui.ts"],
      },
    },
  });

  assert.equal(output.schemaVersion, 2);
  assert.deepEqual(Object.keys(output.lenses).sort(), ["edge_cases", "ui_accessibility"]);
  assert.deepEqual(Object.keys(output.surfaces).sort(), ["authn", "injection"]);
  assert.deepEqual(output.lenses.edge_cases, {
    status: "done",
    headSha: HEAD,
    method: "focused candidate bug review",
    reviewedFiles: ["src/ui.ts"],
  });
  assert.deepEqual(output.surfaces.authn.reviewedFiles, ["src/session.ts"]);
  assert.equal(output.probes["ui-accessibility"].status, "clean");
});

test("aggregated evidence fails when the axis review did not cover a required file", () => {
  assert.equal(typeof preOpenEvidence.expandAggregatePreOpenEvidence, "function");
  assert.throws(
    () => preOpenEvidence.expandAggregatePreOpenEvidence(compactSummary(), {
      schemaVersion: 1,
      kind: "github-delivery/pre-open-review-result",
      headSha: HEAD,
      bug: {
        status: "clean",
        method: "focused candidate bug review",
        reviewedFiles: ["src/ui.ts"],
      },
      security: {
        status: "clean",
        method: "focused candidate security review",
        reviewedFiles: ["src/session.ts", "src/ui.ts"],
      },
      probes: {},
    }),
    /pre_open_review_bug_scope_incomplete/,
  );
});

test("hygiene finalization derives head-bound evidence only from validated result and unchanged bytes", () => {
  assert.equal(typeof hygieneEvidence.buildPreOpenHygieneEvidence, "function");
  const scope = {
    schemaVersion: 1,
    kind: "github-delivery/comment-review-scope",
    baseRef: "base",
    headRef: HEAD,
    files: [{ path: "src/ui.ts", addedRanges: [{ start: 10, end: 12 }] }],
    scopeDigest: `sha256:${"c".repeat(64)}`,
  };
  const result = {
    schemaVersion: 1,
    kind: "github-delivery/comment-review-result",
    scopeDigest: scope.scopeDigest,
    classifications: [
      { path: "src/ui.ts", line: 10, disposition: "KEEP", reason: "public API contract" },
    ],
    rootCauseFlags: [],
  };
  const output = hygieneEvidence.buildPreOpenHygieneEvidence({
    scope,
    commentResult: result,
    guardVerification: { unchanged: true, changedFiles: [], fileCount: 1 },
    simplify: { outcome: "clean", method: "simplify-pass", validationPassed: true },
    headSha: HEAD,
  });

  assert.deepEqual(output, {
    schemaVersion: 1,
    kind: "github-delivery/pre-open-hygiene-evidence",
    headSha: HEAD,
    passes: {
      "no-comments": {
        outcome: "clean",
        method: "comment-inspector",
        scopeKind: "diff-added-lines",
        resultValid: true,
        workspaceVerified: true,
      },
      simplify: {
        outcome: "clean",
        method: "simplify-pass",
        validationPassed: true,
      },
    },
  });
});

test("selected local PR workflow blocks direct git and gh publication before execution", () => {
  const selected = evaluateCodexHook(
    {
      hook_event_name: "PostToolUse",
      session_id: "s1",
      turn_id: "t1",
      tool_name: "Bash",
      tool_input: { command: "node C:/skills/github-delivery/scripts/workflow-brief.mjs create-pr-from-local-work" },
      tool_response: { ok: true },
    },
    {},
  );
  assert.equal(selected.state.localPrWorkflowLocked, true);

  for (const command of [
    "git push origin feature/widgets",
    "gh pr create --base dev --head feature/widgets --title x --body y",
  ]) {
    const blocked = evaluateCodexHook(
      {
        hook_event_name: "PreToolUse",
        session_id: "s1",
        turn_id: "t1",
        tool_name: "Bash",
        tool_input: { command },
      },
      selected.state,
    );
    assert.equal(blocked.output.decision, "block", command);
    assert.match(blocked.output.reason, /create_pr_direct_write_forbidden/);
  }

  const broker = evaluateCodexHook(
    {
      hook_event_name: "PreToolUse",
      session_id: "s1",
      turn_id: "t1",
      tool_name: "Bash",
      tool_input: { command: "node scripts/github-mutate.mjs --request plan.json --execute --checkpoint workflow.json" },
    },
    selected.state,
  );
  assert.equal(broker.output, null);
});

test("direct git push remains outside the guard before local PR workflow selection", () => {
  const result = evaluateCodexHook(
    {
      hook_event_name: "PreToolUse",
      session_id: "s1",
      turn_id: "t1",
      tool_name: "Bash",
      tool_input: { command: "git push origin another-task" },
    },
    {},
  );
  assert.equal(result.output, null);
});
