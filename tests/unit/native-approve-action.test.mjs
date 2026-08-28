import assert from "node:assert/strict";
import test from "node:test";

import {
  executeMutationRequest,
  planMutationRequest,
} from "../../scripts/lib/github-mutation-router.mjs";
import { routeShippingGithubPrompt } from "../../scripts/lib/skill-router.mjs";

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

test("explicit approve intent routes to a native approve_pr action", () => {
  assert.deepEqual(routeShippingGithubPrompt("approve PR #32"), {
    skill: "github-delivery",
    workflow: "references/approve-pr.md",
    mutationMode: "review",
    explicitActions: ["approve_pr"],
  });

  const merged = routeShippingGithubPrompt("approve and merge PR #32 now");
  assert.equal(merged.workflow, "references/merge-pr.md");
  assert.deepEqual(merged.explicitActions.slice(0, 2), ["approve_pr", "merge_pr"]);
});

test("first-class approve action plans the commit-bound native GitHub approval command", () => {
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
  assert.equal(plan.command.includes("--comment"), false);
  assert.equal(plan.command.includes("--request-changes"), false);
  assert.match(plan.request.body, /github-delivery:idempotency/);
});

test("self approval is rejected before attempting the native review write", () => {
  const calls = [];
  assert.throws(
    () => executeMutationRequest({
      request: approvalRequest(),
      execute: true,
      runner(command, args) {
        calls.push([command, ...args]);
        if (args[0] === "pr" && args[1] === "view" && args.includes("headRefOid")) {
          return { status: 0, stdout: `${HEAD}\n`, stderr: "" };
        }
        if (args[0] === "api" && args[1] === "user") {
          return { status: 0, stdout: JSON.stringify({ login: "alice" }), stderr: "" };
        }
        if (args[0] === "pr" && args[1] === "view" && args.includes("author")) {
          return { status: 0, stdout: "alice\n", stderr: "" };
        }
        throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
      },
    }),
    /approve_pr_self_approval_forbidden/,
  );
  assert.equal(
    calls.some((call) =>
      call[1] === "api" &&
      call[2] === "repos/acme/widgets/pulls/32/reviews" &&
      call.includes("--method"),
    ),
    false,
  );
  assert.equal(calls.some((call) => call.includes("--comment")), false);
});
