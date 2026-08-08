import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  executeMutationRequest,
  planMutationRequest,
} from "../../scripts/lib/github-mutation-broker.mjs";

function mergeRequest(overrides = {}) {
  return {
    schemaVersion: 1,
    action: "merge_pr",
    mutationMode: "maintainer",
    explicitInstruction: true,
    repo: "acme/widgets",
    pr: 32,
    expectedHead: "abcdef1234567890",
    mergeMethod: "merge",
    ...overrides,
  };
}

test("denies a mutation before spawning any process", () => {
  let calls = 0;
  assert.throws(
    () =>
      executeMutationRequest({
        request: mergeRequest({ mutationMode: "review" }),
        execute: true,
        runner() {
          calls += 1;
          return { status: 0, stdout: "", stderr: "" };
        },
      }),
    /mutation_denied:mode_denied/,
  );
  assert.equal(calls, 0);
});

test("plans a head-pinned merge without executing it", () => {
  const result = executeMutationRequest({ request: mergeRequest() });
  assert.equal(result.executed, false);
  assert.equal(result.status, "dry_run");
  assert.deepEqual(result.command.slice(0, 6), [
    "gh",
    "pr",
    "merge",
    "32",
    "--repo",
    "acme/widgets",
  ]);
  assert.ok(result.command.includes("--match-head-commit"));
  assert.equal(result.expectedHead, "abcdef1234567890");
});

test("checks the current PR head before a write", () => {
  const calls = [];
  const result = executeMutationRequest({
    request: mergeRequest(),
    execute: true,
    runner(command, args) {
      calls.push([command, ...args]);
      if (args[0] === "pr" && args[1] === "view") {
        return { status: 0, stdout: "abcdef1234567890\n", stderr: "" };
      }
      if (args[0] === "pr" && args[1] === "merge") {
        return { status: 0, stdout: "merged\n", stderr: "" };
      }
      return {
        status: 0,
        stdout: JSON.stringify({ state: "MERGED", mergedAt: "2026-08-01T00:00:00Z" }),
        stderr: "",
      };
    },
  });
  assert.equal(result.executed, true);
  assert.equal(result.status, "succeeded");
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].slice(0, 4), ["gh", "pr", "view", "32"]);
});

test("fails closed when the PR head moved", () => {
  let calls = 0;
  assert.throws(
    () =>
      executeMutationRequest({
        request: mergeRequest(),
        execute: true,
        runner() {
          calls += 1;
          return { status: 0, stdout: "different-head\n", stderr: "" };
        },
      }),
    /expected_head_mismatch/,
  );
  assert.equal(calls, 1);
});

test("requires the hash of the exact approved human reply", () => {
  const body = "Thanks, this is fixed in abc1234.";
  const exactTextSha256 = createHash("sha256").update(body).digest("hex");
  const plan = planMutationRequest({
    schemaVersion: 1,
    action: "reply_human_thread",
    mutationMode: "review",
    exactTextConfirmed: true,
    exactTextSha256,
    idempotencyKey: "reply-review-comment-77",
    repo: "acme/widgets",
    pr: 32,
    expectedHead: "abcdef1234567890",
    commentId: 77,
    body,
  });
  assert.equal(plan.authorization.allowed, true);

  assert.throws(
    () =>
      planMutationRequest({
        ...plan.request,
        exactTextSha256: "wrong",
      }),
    /exact_text_hash_mismatch/,
  );
});

test("social writes require an idempotency key", () => {
  assert.throws(
    () =>
      planMutationRequest({
        schemaVersion: 1,
        action: "post_comment",
        mutationMode: "review",
        repo: "acme/widgets",
        pr: 32,
        expectedHead: "abcdef1234567890",
        body: "Status update",
      }),
    /idempotency_key_required/,
  );
});

test("supersede_pr plans a close with a replacement-naming comment", () => {
  const plan = planMutationRequest({
    schemaVersion: 1,
    action: "supersede_pr",
    mutationMode: "maintainer",
    explicitInstruction: true,
    repo: "acme/widgets",
    pr: 12,
    expectedHead: "abcdef1234567890",
    supersedingPr: 45,
    idempotencyKey: "supersede-pr-12-by-45",
  });
  assert.equal(plan.authorization.allowed, true);
  assert.deepEqual(plan.command.slice(0, 5), [
    "gh",
    "pr",
    "close",
    "12",
    "--repo",
  ]);
  assert.match(plan.command.join(" "), /Superseded by PR #45/);
});

test("supersede_pr requires an idempotency key and a body or superseding PR", () => {
  assert.throws(
    () =>
      planMutationRequest({
        schemaVersion: 1,
        action: "supersede_pr",
        mutationMode: "maintainer",
        explicitInstruction: true,
        repo: "acme/widgets",
        pr: 12,
        expectedHead: "abcdef1234567890",
      }),
    /idempotency_key_required|body_or_superseding_pr_required/,
  );
});

test("close_pr plans a close and verifies the closed state", () => {
  let calls = 0;
  const result = executeMutationRequest({
    request: {
      schemaVersion: 1,
      action: "close_pr",
      mutationMode: "maintainer",
      explicitInstruction: true,
      repo: "acme/widgets",
      pr: 12,
      expectedHead: "abcdef1234567890",
    },
    execute: true,
    runner(command, args) {
      calls += 1;
      if (args[0] === "pr" && args[1] === "view") {
        if (args.includes("headRefOid")) {
          return { status: 0, stdout: "abcdef1234567890\n", stderr: "" };
        }
        return {
          status: 0,
          stdout: JSON.stringify({ state: "CLOSED", closedAt: "2026-08-08T00:00:00Z" }),
          stderr: "",
        };
      }
      if (args[0] === "pr" && args[1] === "close") {
        return { status: 0, stdout: "closed\n", stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    },
  });
  assert.equal(result.executed, true);
  assert.equal(result.status, "succeeded");
  assert.ok(calls >= 3);
  const verification = JSON.parse(result.verification);
  assert.equal(verification.state, "CLOSED");
});

test("delete_head_branch plans a ref delete for the actor-owned head", () => {
  const plan = planMutationRequest({
    schemaVersion: 1,
    action: "delete_head_branch",
    mutationMode: "maintainer",
    explicitInstruction: true,
    repo: "Wibias/opencodex",
    pr: 1004,
    headRefName: "feat/ri-02-request-history-index",
    headOwnerLogin: "Wibias",
    headRepo: "Wibias/opencodex",
    baseRepo: "lidge-jun/opencodex",
    actorLogin: "Wibias",
    isMerged: true,
    isCrossRepository: true,
  });
  assert.equal(plan.authorization.allowed, true);
  assert.deepEqual(plan.command.slice(0, 4), ["gh", "api", "-X", "DELETE"]);
  assert.match(plan.command[4], /repos\/Wibias\/opencodex\/git\/refs\/heads\/feat\/ri-02-request-history-index/);
});

test("delete_head_branch honors headRepository for a fork PR when headRepo is absent", () => {
  const plan = planMutationRequest({
    schemaVersion: 1,
    action: "delete_head_branch",
    mutationMode: "maintainer",
    explicitInstruction: true,
    repo: "lidge-jun/opencodex",
    pr: 1011,
    headRefName: "feat/ri-04-policy-profile-core",
    headOwnerLogin: "Wibias",
    headRepository: "Wibias/opencodex",
    baseRepository: "lidge-jun/opencodex",
    actorLogin: "Wibias",
    isMerged: true,
    isCrossRepository: true,
  });
  assert.equal(plan.authorization.allowed, true);
  assert.equal(plan.request.targetRepo, "Wibias/opencodex");
  assert.match(plan.command[4], /repos\/Wibias\/opencodex\/git\/refs\/heads\/feat\/ri-04-policy-profile-core/);
  assert.ok(!/repos\/lidge-jun\/opencodex\/git/.test(plan.command[4]));
});

test("delete_head_branch lets an explicit targetRepo win over the base repo", () => {
  const plan = planMutationRequest({
    schemaVersion: 1,
    action: "delete_head_branch",
    mutationMode: "maintainer",
    explicitInstruction: true,
    repo: "lidge-jun/opencodex",
    pr: 1011,
    headRefName: "feat/ri-04-policy-profile-core",
    headOwnerLogin: "Wibias",
    targetRepo: "Wibias/opencodex",
    actorLogin: "Wibias",
    isMerged: true,
    isCrossRepository: true,
  });
  assert.equal(plan.request.targetRepo, "Wibias/opencodex");
  assert.match(plan.command[4], /repos\/Wibias\/opencodex\/git\/refs\/heads\/feat\/ri-04-policy-profile-core/);
});

test("delete_head_branch rejects another user's head", () => {
  assert.throws(
    () =>
      planMutationRequest({
        schemaVersion: 1,
        action: "delete_head_branch",
        mutationMode: "maintainer",
        explicitInstruction: true,
        repo: "Wibias/opencodex",
        pr: 1004,
        headRefName: "feat/ri-02-request-history-index",
        headOwnerLogin: "Wibias",
        headRepo: "Wibias/opencodex",
        baseRepo: "lidge-jun/opencodex",
        actorLogin: "other-user",
        isMerged: true,
        isCrossRepository: true,
      }),
    /branch kept: head owned by @Wibias/,
  );
});

function editOwnCommentRequest(overrides = {}) {
  return {
    schemaVersion: 1,
    action: "edit_own_comment",
    mutationMode: "review",
    repo: "acme/widgets",
    pr: 32,
    expectedHead: "abcdef1234567890",
    commentId: 77,
    body: "[GD] corrected verdict",
    idempotencyKey: "edit-verdict-77",
    ...overrides,
  };
}

test("edit_own_comment rejects a comment owned by another GitHub actor before PATCH", () => {
  const calls = [];
  assert.throws(
    () =>
      executeMutationRequest({
        request: editOwnCommentRequest(),
        execute: true,
        runner(command, args) {
          calls.push([command, ...args]);
          if (args[0] === "pr" && args[1] === "view") {
            return { status: 0, stdout: "abcdef1234567890\n", stderr: "" };
          }
          if (args[0] === "api" && args[1] === "user") {
            return {
              status: 0,
              stdout: JSON.stringify({ login: "github-delivery-agent" }),
              stderr: "",
            };
          }
          if (args[0] === "api" && args[1].endsWith("/issues/comments/77")) {
            return {
              status: 0,
              stdout: JSON.stringify({
                user: { login: "maintainer" },
                issue_url: "https://api.github.com/repos/acme/widgets/issues/32",
              }),
              stderr: "",
            };
          }
          return { status: 0, stdout: "", stderr: "" };
        },
      }),
    /comment_not_owned_by_actor/,
  );
  assert.equal(calls.some((call) => call.includes("PATCH")), false);
});

test("edit_own_comment rejects an owned comment attached to a different PR", () => {
  const calls = [];
  assert.throws(
    () =>
      executeMutationRequest({
        request: editOwnCommentRequest(),
        execute: true,
        runner(command, args) {
          calls.push([command, ...args]);
          if (args[0] === "pr" && args[1] === "view") {
            return { status: 0, stdout: "abcdef1234567890\n", stderr: "" };
          }
          if (args[0] === "api" && args[1] === "user") {
            return {
              status: 0,
              stdout: JSON.stringify({ login: "github-delivery-agent" }),
              stderr: "",
            };
          }
          if (args[0] === "api" && args[1].endsWith("/issues/comments/77")) {
            return {
              status: 0,
              stdout: JSON.stringify({
                user: { login: "github-delivery-agent" },
                issue_url: "https://api.github.com/repos/acme/widgets/issues/99",
              }),
              stderr: "",
            };
          }
          return { status: 0, stdout: "", stderr: "" };
        },
      }),
    /comment_target_mismatch/,
  );
  assert.equal(calls.some((call) => call.includes("PATCH")), false);
});

test("edit_own_comment allows the authenticated actor to edit its comment on the expected PR", () => {
  const calls = [];
  const result = executeMutationRequest({
    request: editOwnCommentRequest(),
    execute: true,
    runner(command, args) {
      calls.push([command, ...args]);
      if (args[0] === "pr" && args[1] === "view") {
        return { status: 0, stdout: "abcdef1234567890\n", stderr: "" };
      }
      if (args[0] === "api" && args[1] === "user") {
        return {
          status: 0,
          stdout: JSON.stringify({ login: "github-delivery-agent" }),
          stderr: "",
        };
      }
      if (
        args[0] === "api" &&
        args[1].endsWith("/issues/comments/77") &&
        !args.includes("PATCH")
      ) {
        return {
          status: 0,
          stdout: JSON.stringify({
            user: { login: "github-delivery-agent" },
            issue_url: "https://api.github.com/repos/acme/widgets/issues/32",
          }),
          stderr: "",
        };
      }
      if (args.includes("PATCH")) {
        return { status: 0, stdout: JSON.stringify({ id: 77 }), stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    },
  });
  assert.equal(result.status, "succeeded");
  assert.equal(calls.filter((call) => call.includes("PATCH")).length, 1);
});

function deleteHeadRequest() {
  return {
    schemaVersion: 1,
    action: "delete_head_branch",
    mutationMode: "maintainer",
    explicitInstruction: true,
    repo: "Wibias/opencodex",
    pr: 1004,
    headRefName: "feat/ri-02-request-history-index",
    headOwnerLogin: "Wibias",
    headRepo: "Wibias/opencodex",
    baseRepo: "lidge-jun/opencodex",
    actorLogin: "Wibias",
    isMerged: true,
    isCrossRepository: true,
  };
}

test("delete_head_branch treats a 403 verification response as unknown instead of deleted", () => {
  assert.throws(
    () =>
      executeMutationRequest({
        request: deleteHeadRequest(),
        execute: true,
        runner(command, args) {
          if (args.includes("DELETE")) {
            return { status: 0, stdout: "", stderr: "" };
          }
          return {
            status: 1,
            stdout: "",
            stderr: "HTTP 403: Resource not accessible by integration",
          };
        },
      }),
    /branch_delete_verification_failed/,
  );
});

test("delete_head_branch accepts only an explicit not-found verification as deleted", () => {
  const result = executeMutationRequest({
    request: deleteHeadRequest(),
    execute: true,
    runner(command, args) {
      if (args.includes("DELETE")) {
        return { status: 0, stdout: "", stderr: "" };
      }
      return {
        status: 1,
        stdout: "",
        stderr: "HTTP 404: Not Found",
      };
    },
  });
  assert.equal(result.verification, "deleted");
});
