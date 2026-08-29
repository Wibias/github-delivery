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
  let created = false;
  let createdBody = null;
  let createCalls = 0;
  let authorityCalls = 0;

  const result = executeMutationWithAuthority({
    request: createIssueRequest(),
    execute: true,
    config: OFF,
    trustedWorkflowIntent: true,
    redeemer() {
      authorityCalls += 1;
      throw new Error("off mode must not redeem trusted authority");
    },
    runner(command, args) {
      if (command === "gh" && args[0] === "api" && String(args[1]).includes("issues?state=all")) {
        const exactIssue = created
          ? [{
              id: 88,
              number: 88,
              user: { login: "agent" },
              title: "Boundary regression",
              body: createdBody,
              html_url: "https://github.test/acme/widgets/issues/88",
            }]
          : [];
        return { status: 0, stdout: JSON.stringify([exactIssue]), stderr: "" };
      }
      if (command === "gh" && args[0] === "api" && args[1] === "user") {
        return { status: 0, stdout: "agent\n", stderr: "" };
      }
      if (command === "gh" && args[0] === "issue" && args[1] === "create") {
        createCalls += 1;
        created = true;
        createdBody = args[args.indexOf("--body") + 1];
        return { status: 0, stdout: "https://github.test/acme/widgets/issues/88\n", stderr: "" };
      }
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    },
  });

  assert.equal(authorityCalls, 0);
  assert.equal(createCalls, 1);
  assert.equal(result.status, "succeeded");
  assert.equal(result.verification.number, 88);
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
