import assert from "node:assert/strict";
import test from "node:test";

import {
  executeMutationWithAuthority,
  planMutationWithAuthority,
} from "../../scripts/lib/mutation-execution-context.mjs";

const OFF = { schemaVersion: 1, authorityMode: "off" };

function createIssueRequest(overrides = {}) {
  return {
    schemaVersion: 1,
    action: "create_issue",
    mutationMode: "maintainer",
    explicitInstruction: false,
    repo: "acme/widgets",
    idempotencyKey: "audit-003-create",
    title: "Boundary regression",
    body: "body",
    ...overrides,
  };
}

function assignIssueRequest(overrides = {}) {
  return {
    schemaVersion: 1,
    action: "assign_issue",
    mutationMode: "maintainer",
    explicitInstruction: false,
    repo: "acme/widgets",
    issue: 88,
    assignee: "agent",
    ...overrides,
  };
}

test("authority off preserves controller-owned workflow intent without producing verified user authority", () => {
  const plan = planMutationWithAuthority(createIssueRequest(), {
    config: OFF,
    trustedWorkflowIntent: true,
  });
  assert.equal(plan.authorization.allowed, true);
  assert.equal(plan.authority.verified, false);
  assert.equal(plan.authority.provenance, "authority_disabled_by_user");
});

test("authority off executes a workflow-authorized mutation without trusted-authority redemption", () => {
  let editCalls = 0;
  let authorityCalls = 0;

  const result = executeMutationWithAuthority({
    request: assignIssueRequest(),
    execute: true,
    config: OFF,
    trustedWorkflowIntent: true,
    redeemer() {
      authorityCalls += 1;
      throw new Error("off mode must not redeem trusted authority");
    },
    runner(command, args) {
      if (command === "gh" && args[0] === "issue" && args[1] === "edit") {
        editCalls += 1;
        return { status: 0, stdout: "https://github.test/acme/widgets/issues/88\n", stderr: "" };
      }
      if (command === "gh" && args[0] === "issue" && args[1] === "view") {
        return {
          status: 0,
          stdout: JSON.stringify({ assignees: [{ login: "agent" }] }),
          stderr: "",
        };
      }
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    },
  });

  assert.equal(authorityCalls, 0);
  assert.equal(editCalls, 1);
  assert.equal(result.status, "succeeded");
  assert.equal(result.authority.verified, false);
  assert.equal(result.authority.provenance, "authority_disabled_by_user");
});

test("authority off still rejects caller-controlled explicit instruction without trusted workflow intent", () => {
  assert.throws(
    () => executeMutationWithAuthority({
      request: createIssueRequest({ explicitInstruction: true }),
      execute: true,
      config: OFF,
      trustedWorkflowIntent: false,
      runner() {
        throw new Error("runner_must_not_be_called");
      },
    }),
    /explicit_instruction_required/,
  );
});
