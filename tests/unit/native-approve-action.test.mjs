import assert from "node:assert/strict";
import test from "node:test";

import {
  executeMutationRequest,
  planMutationRequest,
} from "../../scripts/lib/github-mutation-broker.mjs";
import { routeShippingGithubPrompt } from "../../scripts/lib/skill-router.mjs";

const HEAD = "abcdef1234567890abcdef1234567890abcdef12";

function approvalRequest(overrides = {}) {
  return {
    schemaVersion: 1,
    action: "post_review",
    event: "approve",
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

test("brokered approve review plans the native GitHub approval command", () => {
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
  assert.equal(plan.command.includes("--comment"), false);
  assert.equal(plan.command.includes("--request-changes"), false);
  assert.match(plan.request.body, /github-delivery:idempotency/);
});

test("GitHub self-approval rejection is surfaced instead of substituting a comment", () => {
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
        if (args[0] === "api" && args[1].includes("pulls/32/reviews")) {
          return { status: 0, stdout: "[]", stderr: "" };
        }
        if (args[0] === "pr" && args[1] === "review" && args.includes("--approve")) {
          return {
            status: 1,
            stdout: "",
            stderr: "Review Can not approve your own pull request",
          };
        }
        throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
      },
    }),
    /Review Can not approve your own pull request/,
  );
  assert.equal(calls.some((call) => call.includes("--approve")), true);
  assert.equal(calls.some((call) => call.includes("--comment")), false);
});
