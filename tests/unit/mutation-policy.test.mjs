import assert from "node:assert/strict";
import test from "node:test";
import {
  executeMutationRequest,
  idempotencyMarker,
  planMutationRequest,
} from "../../scripts/lib/github-mutation-broker.mjs";
import { mutationRequiresTrustedAuthority } from "../../scripts/lib/mutation-execution-context.mjs";
import {
  authorizeMutation,
  extractMutationModeArgs,
  mutationProfile,
} from "../../scripts/lib/mutation-policy.mjs";

test("read-only permits evidence reads but denies GitHub writes", () => {
  const profile = mutationProfile("read-only");
  assert.equal(profile.actions.read_evidence.allowed, true);
  assert.equal(profile.actions.merge_pr.allowed, false);
  assert.equal(profile.actions.post_comment.allowed, false);
});

test("review can publish reviews and resolve bot threads", () => {
  const profile = mutationProfile("review");
  assert.equal(profile.actions.post_review.allowed, true);
  assert.equal(profile.actions.resolve_thread.allowed, false);
  assert.equal(profile.actions.resolve_bot_thread.allowed, true);
});

test("review human replies require exact text and trusted execution", () => {
  const denied = authorizeMutation({
    mode: "review",
    action: "reply_human_thread",
  });
  const allowed = authorizeMutation({
    mode: "review",
    action: "reply_human_thread",
    exactTextConfirmed: true,
  });
  assert.equal(denied.reason, "exact_text_confirmation_required");
  assert.equal(allowed.allowed, true);
  assert.equal(
    mutationRequiresTrustedAuthority({
      mutationMode: "review",
      action: "reply_human_thread",
    }),
    true,
  );
});

test("maintainer human replies still require exact-text confirmation", () => {
  const denied = authorizeMutation({
    mode: "maintainer",
    action: "reply_human_thread",
  });
  const allowed = authorizeMutation({
    mode: "maintainer",
    action: "reply_human_thread",
    exactTextConfirmed: true,
  });
  assert.equal(denied.reason, "exact_text_confirmation_required");
  assert.equal(allowed.allowed, true);
});

test("social comments require trusted authority, including full-review verdicts", () => {
  const base = {
    action: "post_comment",
    mutationMode: "review",
    repo: "acme/widgets",
    pr: 32,
    expectedHead: "abcdef1234567890",
  };
  assert.equal(
    mutationRequiresTrustedAuthority({ ...base, body: "ordinary review note" }),
    true,
  );
  assert.equal(
    mutationRequiresTrustedAuthority({
      ...base,
      body: [
        "## [GD] Verdict: approve-comment",
        "<!-- github-delivery:full-review-verdict run:fr-32 head:abcdef1234567890 -->",
      ].join("\n"),
    }),
    true,
  );
});

test("maintainer mutations require explicit instruction", () => {
  const denied = authorizeMutation({ mode: "maintainer", action: "merge_pr" });
  const allowed = authorizeMutation({
    mode: "maintainer",
    action: "merge_pr",
    explicitInstruction: true,
  });
  assert.equal(denied.reason, "explicit_instruction_required");
  assert.equal(allowed.allowed, true);
});

test("close_pr requires explicit maintainer instruction", () => {
  const denied = authorizeMutation({ mode: "maintainer", action: "close_pr" });
  const allowed = authorizeMutation({
    mode: "maintainer",
    action: "close_pr",
    explicitInstruction: true,
  });
  assert.equal(denied.reason, "explicit_instruction_required");
  assert.equal(allowed.allowed, true);
});

test("legacy composite supersede_pr is not a primitive mutation", () => {
  const decision = authorizeMutation({
    mode: "maintainer",
    action: "supersede_pr",
    explicitInstruction: true,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "unknown_action");
  assert.equal(mutationProfile("maintainer").actions.supersede_pr, undefined);
});

test("read-only and review never allow closing a PR", () => {
  for (const mode of ["read-only", "review"]) {
    const profile = mutationProfile(mode);
    assert.equal(profile.actions.close_pr.allowed, false);
    assert.equal(profile.actions.supersede_pr, undefined);
  }
});

test("autonomous mode still requires exact text for human replies", () => {
  const denied = authorizeMutation({
    mode: "autonomous",
    action: "reply_human_thread",
  });
  const allowed = authorizeMutation({
    mode: "autonomous",
    action: "reply_human_thread",
    exactTextConfirmed: true,
  });
  assert.equal(denied.reason, "exact_text_confirmation_required");
  assert.equal(allowed.allowed, true);
});

test("autonomous merge, close, and delete still require explicit instruction", () => {
  for (const action of ["merge_pr", "close_pr", "delete_head_branch"]) {
    const denied = authorizeMutation({ mode: "autonomous", action });
    const allowed = authorizeMutation({
      mode: "autonomous",
      action,
      explicitInstruction: true,
    });
    assert.equal(denied.allowed, false, action);
    assert.equal(denied.reason, "explicit_instruction_required", action);
    assert.equal(allowed.allowed, true, action);
  }
});

test("extracts mutation flags without leaking them to another parser", () => {
  const result = extractMutationModeArgs([
    "OWNER/REPO",
    "7",
    "--mutation-mode",
    "maintainer",
    "--explicit",
    "--snapshot",
    "evidence.json",
  ]);
  assert.deepEqual(result, {
    argv: ["OWNER/REPO", "7", "--snapshot", "evidence.json"],
    mode: "maintainer",
    explicitInstruction: true,
    exactTextConfirmed: false,
  });
});

test("social mutation plans embed a stable remote idempotency marker", () => {
  const request = {
    schemaVersion: 1,
    action: "post_comment",
    mutationMode: "review",
    repo: "acme/widgets",
    pr: 32,
    expectedHead: "abcdef1234567890",
    idempotencyKey: "status-pr-32-head-abcdef",
    body: "[GD] Status update",
  };
  const first = planMutationRequest(request);
  const second = planMutationRequest(request);
  const marker = idempotencyMarker(request.idempotencyKey);
  assert.equal(first.request.idempotencyMarker, marker);
  assert.equal(second.request.idempotencyMarker, marker);
  assert.match(first.request.body, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("a retry reuses an existing GitHub social mutation instead of posting a duplicate", () => {
  const key = "status-pr-32-head-abcdef";
  const marker = idempotencyMarker(key);
  let writes = 0;
  const result = executeMutationRequest({
    request: {
      schemaVersion: 1,
      action: "post_comment",
      mutationMode: "review",
      repo: "acme/widgets",
      pr: 32,
      expectedHead: "abcdef1234567890",
      idempotencyKey: key,
      body: "[GD] Status update",
    },
    execute: true,
    runner(command, args) {
      if (args[0] === "pr" && args[1] === "view") {
        return { status: 0, stdout: "abcdef1234567890\n", stderr: "" };
      }
      if (args[0] === "api" && String(args[1]).includes("/issues/32/comments")) {
        return {
          status: 0,
          stdout: JSON.stringify([[{
            id: 321,
            html_url: "https://github.com/acme/widgets/pull/32#issuecomment-321",
            body: `[GD] Status update\n\n${marker}`,
          }]]),
          stderr: "",
        };
      }
      if (args[0] === "pr" && args[1] === "comment") {
        writes += 1;
        return { status: 0, stdout: "posted", stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    },
  });
  assert.equal(result.status, "already_applied");
  assert.equal(result.executed, false);
  assert.equal(result.existingMutation.id, 321);
  assert.equal(writes, 0);
});

test("idempotency lookup failure fails closed before a social write", () => {
  let writes = 0;
  assert.throws(
    () =>
      executeMutationRequest({
        request: {
          schemaVersion: 1,
          action: "post_comment",
          mutationMode: "review",
          repo: "acme/widgets",
          pr: 32,
          expectedHead: "abcdef1234567890",
          idempotencyKey: "status-pr-32-head-abcdef",
          body: "[GD] Status update",
        },
        execute: true,
        runner(command, args) {
          if (args[0] === "pr" && args[1] === "view") {
            return { status: 0, stdout: "abcdef1234567890\n", stderr: "" };
          }
          if (args[0] === "api" && String(args[1]).includes("/issues/32/comments")) {
            return { status: 1, stdout: "", stderr: "HTTP 429: rate limit" };
          }
          if (args[0] === "pr" && args[1] === "comment") writes += 1;
          return { status: 0, stdout: "", stderr: "" };
        },
      }),
    /HTTP 429|idempotency_lookup_failed/,
  );
  assert.equal(writes, 0);
});
