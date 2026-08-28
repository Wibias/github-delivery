import assert from "node:assert/strict";
import test from "node:test";

import {
  executeMutationRequest,
  planMutationRequest,
} from "../../scripts/lib/github-mutation-router.mjs";
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

test("approve_pr plans a commit-bound native approval while post_review cannot smuggle approval", () => {
  const plan = planMutationRequest(approvalRequest());
  assert.deepEqual(plan.command.slice(0, 9), [
    "gh",
    "api",
    "repos/acme/widgets/pulls/32/reviews",
    "--method",
    "POST",
    "-f",
    `commit_id=${HEAD}`,
    "-f",
    "event=APPROVE",
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
    bodySha256: "6fcfaa57b122361308f7bce0a8f2c09bbbfbd64cb2cdad51c9a291bdd3844804",
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
  assert.equal(
    calls.some((call) => call[0] === "gh" && call[1] === "api" && call.includes("--method") && call.includes("POST")),
    false,
  );
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
