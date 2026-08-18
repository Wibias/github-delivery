import assert from "node:assert/strict";
import test from "node:test";

import {
  headRefreshCandidate,
  refreshExpectedHeads,
} from "../../scripts/lib/authority-head-refresh.mjs";

function request(overrides = {}) {
  return {
    schemaVersion: 1,
    action: "post_comment",
    mutationMode: "maintainer",
    explicitInstruction: true,
    repo: "acme/widgets",
    pr: 32,
    expectedHead: "a".repeat(40),
    body: "Status update",
    idempotencyKey: "post-32",
    ...overrides,
  };
}

function liveHead(head, branch = "feature/audit") {
  return JSON.stringify({ headRefOid: head, headRefName: branch });
}

test("headRefreshCandidate selects PR-scoped actions with an expected head", () => {
  assert.equal(headRefreshCandidate(request()), true);
  assert.equal(headRefreshCandidate(request({ action: "merge_pr" })), true);
  assert.equal(headRefreshCandidate(request({ action: "close_pr" })), true);
  assert.equal(headRefreshCandidate(request({ action: "post_comment", expectedHead: undefined })), false);
  assert.equal(headRefreshCandidate(request({ action: "post_issue_comment" })), false);
  assert.equal(headRefreshCandidate(request({ action: "create_issue" })), false);
  assert.equal(headRefreshCandidate(request({ action: "push_code" })), false);
});

test("refreshExpectedHeads binds the live PR branch even when the head already matches", () => {
  const runner = (args) => {
    assert.deepEqual(args, [
      "gh", "pr", "view", "32", "--repo", "acme/widgets", "--json", "headRefOid,headRefName",
    ]);
    return liveHead("a".repeat(40), "feature/audit");
  };
  const result = refreshExpectedHeads({
    requests: [request()],
    runner,
  });
  assert.equal(result.refreshed.length, 0);
  assert.equal(result.requests[0].expectedHead, "a".repeat(40));
  assert.equal(result.requests[0].authorityBranch, "feature/audit");
});

test("refreshExpectedHeads updates a stale head, binds branch, and reports the delta", () => {
  const runner = () => liveHead("b".repeat(40), "feature/review");
  assert.throws(
    () => refreshExpectedHeads({ requests: [request()], runner }),
    /expected_head_mismatch: expected a{40}, observed b{40}/,
  );
});

test("refreshExpectedHeads binds matching heads and fails closed before authorizing a moved head", () => {
  const runner = (args) => liveHead("c".repeat(40), `feature/pr-${args[3]}`);
  const stale = request({ pr: 1, expectedHead: "a".repeat(40), idempotencyKey: "k1" });
  const fresh = request({ pr: 2, expectedHead: "c".repeat(40), idempotencyKey: "k2" });
  assert.throws(
    () =>
      refreshExpectedHeads({
        requests: [stale, fresh, request({ action: "post_issue_comment", pr: 3, expectedHead: undefined })],
        runner,
      }),
    /expected_head_mismatch/,
  );
  const result = refreshExpectedHeads({
    requests: [fresh, request({ action: "post_issue_comment", pr: 3, expectedHead: undefined })],
    runner,
  });
  assert.equal(result.refreshed.length, 0);
  assert.equal(result.requests[0].expectedHead, "c".repeat(40));
  assert.equal(result.requests[0].authorityBranch, "feature/pr-2");
  assert.equal(result.requests[1].action, "post_issue_comment");
  assert.equal(result.requests[1].authorityBranch, undefined);
});

test("refreshExpectedHeads fails closed when live head or branch evidence is invalid", () => {
  assert.throws(
    () =>
      refreshExpectedHeads({
        requests: [request()],
        runner() {
          throw new Error("gh: repo not found");
        },
      }),
    /gh: repo not found/,
  );
  assert.throws(
    () =>
      refreshExpectedHeads({
        requests: [request()],
        runner() {
          return JSON.stringify({ headRefOid: "not-a-sha", headRefName: "feature/audit" });
        },
      }),
    /authority_head_refresh_invalid_head/,
  );
  assert.throws(
    () =>
      refreshExpectedHeads({
        requests: [request()],
        runner() {
          return JSON.stringify({ headRefOid: "a".repeat(40), headRefName: "" });
        },
      }),
    /authority_head_refresh_invalid_branch/,
  );
});

test("refreshExpectedHeads requires a runner for PR-scoped operations", () => {
  assert.throws(
    () => refreshExpectedHeads({ requests: [request()] }),
    /authority_head_refresh_runner_required/,
  );
});
