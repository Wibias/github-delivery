import assert from "node:assert/strict";
import test from "node:test";

import {
  executeMutationRequest,
  planMutationRequest,
} from "../../scripts/lib/github-mutation-broker.mjs";
import { authorityScopeForRequest } from "../../scripts/lib/authority-scope.mjs";
import { actionDefinition } from "../../scripts/lib/mutation-action-registry.mjs";
import { authorizeMutation } from "../../scripts/lib/mutation-policy.mjs";
import { validateWorkflowMutationMode } from "../../scripts/lib/workflow-mode.mjs";

const HEAD = "abcdef1234567890abcdef1234567890abcdef12";

function approvalRequest(overrides = {}) {
  return {
    schemaVersion: 1,
    action: "approve_pr",
    mutationMode: "review",
    explicitInstruction: true,
    repo: "acme/widgets",
    pr: 32,
    expectedHead: HEAD,
    idempotencyKey: `approve-32-${HEAD}`,
    body: "Approving as explicitly requested.",
    ...overrides,
  };
}

test("approve_pr is a first-class high-assurance review mutation with explicit intent", () => {
  const definition = actionDefinition("approve_pr");
  assert.equal(definition?.enabled, true);
  assert.equal(definition?.prBound, true);
  assert.equal(definition?.social, true);
  assert.equal(definition?.highAssurance, true);

  assert.deepEqual(
    authorizeMutation({ mode: "review", action: "approve_pr", explicitInstruction: false }),
    {
      allowed: false,
      mode: "review",
      action: "approve_pr",
      reason: "explicit_instruction_required",
      rule: {
        allowed: true,
        requiresExplicitInstruction: true,
        requiresExactTextConfirmation: false,
      },
    },
  );
  assert.equal(
    authorizeMutation({ mode: "review", action: "approve_pr", explicitInstruction: true }).allowed,
    true,
  );
});

test("approve_pr plans native approval while post_review cannot smuggle approval", () => {
  const plan = planMutationRequest(approvalRequest());
  assert.deepEqual(plan.command.slice(0, 7), [
    "gh",
    "pr",
    "review",
    "32",
    "--repo",
    "acme/widgets",
    "--approve",
  ]);
  assert.equal(plan.request.action, "approve_pr");

  assert.throws(
    () => planMutationRequest({
      ...approvalRequest({ action: "post_review" }),
      event: "approve",
    }),
    /review_event_invalid|post_review_approve_forbidden/,
  );
});

test("approve_pr authority scope is semantically distinct from generic post_review", () => {
  assert.deepEqual(authorityScopeForRequest(approvalRequest()), {
    action: "approve_pr",
    mutationMode: "review",
    repo: "acme/widgets",
    pr: 32,
    expectedHead: HEAD,
    idempotencyKey: `approve-32-${HEAD}`,
    bodySha256: "1959421ecb01f1bd9b66540df3902e92fab51ae26ec3353c27d05b88c46cec61",
  });
});

test("self approval is rejected before the approval write is attempted", () => {
  const calls = [];
  assert.throws(
    () => executeMutationRequest({
      request: approvalRequest(),
      execute: true,
      requireTrustedAuthority: false,
      runner(command, args) {
        calls.push([command, ...args]);
        if (command === "gh" && args[0] === "pr" && args[1] === "view" && args.includes("headRefOid")) {
          return { status: 0, stdout: `${HEAD}\n`, stderr: "" };
        }
        if (command === "gh" && args[0] === "api" && args[1] === "user") {
          return { status: 0, stdout: JSON.stringify({ login: "alice" }), stderr: "" };
        }
        if (command === "gh" && args[0] === "pr" && args[1] === "view" && args.includes("author")) {
          return { status: 0, stdout: "alice\n", stderr: "" };
        }
        throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
      },
    }),
    /self_approval|approve_pr_self_approval_forbidden/,
  );
  assert.equal(calls.some((call) => call.includes("--approve")), false);
});

test("approve workflow accepts review mutation mode", () => {
  assert.deepEqual(
    validateWorkflowMutationMode({
      workflow: "references/approve-pr.md",
      mutationMode: "review",
    }),
    {
      valid: true,
      workflow: "references/approve-pr.md",
      mutationMode: "review",
      allowedModes: ["review"],
      reason: null,
    },
  );
});
