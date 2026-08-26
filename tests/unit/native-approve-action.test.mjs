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
    action: "approve_pr",
    mutationMode: "review",
    explicitInstruction: true,
    repo: "acme/widgets",
    pr: 32,
    expectedHead: HEAD,
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

test("approve_pr plans the native GitHub approval command", () => {
  const plan = planMutationRequest(approvalRequest());
  assert.deepEqual(plan.command, [
    "gh",
    "pr",
    "review",
    "32",
    "--repo",
    "acme/widgets",
    "--approve",
  ]);
});

test("approve_pr fails before mutation when the authenticated viewer authored the PR", () => {
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
          return { status: 0, stdout: JSON.stringify({ login: "author" }), stderr: "" };
        }
        if (args[0] === "api" && args[1] === "repos/acme/widgets/pulls/32") {
          return {
            status: 0,
            stdout: JSON.stringify({ user: { login: "author" } }),
            stderr: "",
          };
        }
        throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
      },
    }),
    /self_approval_forbidden/,
  );
  assert.equal(calls.some((call) => call.includes("--approve")), false);
});
