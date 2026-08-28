import assert from "node:assert/strict";
import test from "node:test";

import {
  executeApprovalMutationRequest,
  planApprovalMutationRequest,
} from "../../scripts/lib/github-approval-mutation-broker.mjs";

const HEAD = "a".repeat(40);
const NEW_HEAD = "b".repeat(40);

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

test("native approval write binds the REST review to expectedHead", () => {
  const plan = planApprovalMutationRequest(approvalRequest());
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
});

test("foreign approval with the same marker is not accepted as this actor's idempotent receipt", () => {
  let reviewReads = 0;
  let writeSeen = false;
  const result = executeApprovalMutationRequest({
    request: approvalRequest(),
    execute: true,
    requireTrustedAuthority: false,
    runner(command, args) {
      if (command === "gh" && args[0] === "pr" && args[1] === "view" && args.includes("headRefOid")) {
        return { status: 0, stdout: `${HEAD}\n`, stderr: "" };
      }
      if (command === "gh" && args[0] === "api" && args[1] === "user") {
        return { status: 0, stdout: JSON.stringify({ login: "alice" }), stderr: "" };
      }
      if (command === "gh" && args[0] === "pr" && args[1] === "view" && args.includes("author")) {
        return { status: 0, stdout: "bob\n", stderr: "" };
      }
      if (command === "gh" && args[0] === "api" && args[1] === "repos/acme/widgets/pulls/32/reviews" && args.includes("--paginate")) {
        reviewReads += 1;
        const foreign = {
          id: 1,
          state: "APPROVED",
          body: planApprovalMutationRequest(approvalRequest()).request.body,
          commit_id: HEAD,
          user: { login: "mallory" },
        };
        const own = {
          id: 2,
          state: "APPROVED",
          body: planApprovalMutationRequest(approvalRequest()).request.body,
          commit_id: HEAD,
          user: { login: "alice" },
        };
        return {
          status: 0,
          stdout: JSON.stringify(reviewReads === 1 ? [foreign] : [foreign, own]),
          stderr: "",
        };
      }
      if (command === "gh" && args[0] === "api" && args[1] === "repos/acme/widgets/pulls/32/reviews" && args.includes("--method")) {
        writeSeen = true;
        return { status: 0, stdout: JSON.stringify({ id: 2 }), stderr: "" };
      }
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    },
  });
  assert.equal(writeSeen, true);
  assert.equal(result.status, "succeeded");
  assert.equal(result.verification.user.login, "alice");
  assert.equal(result.verification.commit_id, HEAD);
});

test("head movement after approval write cannot be reported as successful approval", () => {
  let headReads = 0;
  assert.throws(
    () => executeApprovalMutationRequest({
      request: approvalRequest(),
      execute: true,
      requireTrustedAuthority: false,
      runner(command, args) {
        if (command === "gh" && args[0] === "pr" && args[1] === "view" && args.includes("headRefOid")) {
          headReads += 1;
          return { status: 0, stdout: `${headReads === 1 ? HEAD : NEW_HEAD}\n`, stderr: "" };
        }
        if (command === "gh" && args[0] === "api" && args[1] === "user") {
          return { status: 0, stdout: JSON.stringify({ login: "alice" }), stderr: "" };
        }
        if (command === "gh" && args[0] === "pr" && args[1] === "view" && args.includes("author")) {
          return { status: 0, stdout: "bob\n", stderr: "" };
        }
        if (command === "gh" && args[0] === "api" && args[1] === "repos/acme/widgets/pulls/32/reviews" && args.includes("--paginate")) {
          return { status: 0, stdout: "[]", stderr: "" };
        }
        if (command === "gh" && args[0] === "api" && args[1] === "repos/acme/widgets/pulls/32/reviews" && args.includes("--method")) {
          return { status: 0, stdout: JSON.stringify({ id: 2 }), stderr: "" };
        }
        if (command === "gh" && args[0] === "pr" && args[1] === "review") {
          return { status: 0, stdout: "", stderr: "" };
        }
        throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
      },
    }),
    /approve_pr_head_changed_after_write/,
  );
});
