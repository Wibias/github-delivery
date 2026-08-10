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

test("headRefreshCandidate selects PR-scoped actions with an expected head", () => {
  assert.equal(headRefreshCandidate(request()), true);
  assert.equal(headRefreshCandidate(request({ action: "merge_pr" })), true);
  assert.equal(headRefreshCandidate(request({ action: "close_pr" })), true);
  assert.equal(headRefreshCandidate(request({ action: "post_comment", expectedHead: undefined })), false);
  assert.equal(headRefreshCandidate(request({ action: "post_issue_comment" })), false);
  assert.equal(headRefreshCandidate(request({ action: "create_issue" })), false);
  assert.equal(headRefreshCandidate(request({ action: "push_code" })), false);
});

test("refreshExpectedHeads leaves matching heads untouched", () => {
  const runner = (args) => {
    assert.deepEqual(args.slice(0, 4), ["gh", "pr", "view", "32"]);
    return `${"a".repeat(40)}\n`;
  };
  const result = refreshExpectedHeads({
    requests: [request()],
    runner,
  });
  assert.equal(result.refreshed.length, 0);
  assert.equal(result.requests[0].expectedHead, "a".repeat(40));
});

test("refreshExpectedHeads updates a stale head and reports the delta", () => {
  const runner = () => `${"b".repeat(40)}\n`;
  const result = refreshExpectedHeads({
    requests: [request()],
    runner,
  });
  assert.equal(result.refreshed.length, 1);
  assert.deepEqual(result.refreshed[0], {
    index: 0,
    pr: 32,
    repo: "acme/widgets",
    from: "a".repeat(40),
    to: "b".repeat(40),
  });
  assert.equal(result.requests[0].expectedHead, "b".repeat(40));
  assert.equal(result.requests[0].body, "Status update");
});

test("refreshExpectedHeads refreshes only stale operations in a batch", () => {
  const runner = () => `${"c".repeat(40)}\n`;
  const stale = request({ pr: 1, expectedHead: "a".repeat(40), idempotencyKey: "k1" });
  const fresh = request({ pr: 2, expectedHead: "c".repeat(40), idempotencyKey: "k2" });
  const result = refreshExpectedHeads({
    requests: [stale, fresh, request({ action: "post_issue_comment", pr: 3, expectedHead: undefined })],
    runner,
  });
  assert.deepEqual(result.refreshed.map((entry) => entry.pr), [1]);
  assert.equal(result.requests[0].expectedHead, "c".repeat(40));
  assert.equal(result.requests[1].expectedHead, "c".repeat(40));
  assert.equal(result.requests[2].action, "post_issue_comment");
});

test("refreshExpectedHeads fails closed when the read errors or returns a bad head", () => {
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
          return "not-a-sha\n";
        },
      }),
    /authority_head_refresh_invalid_head/,
  );
});

test("refreshExpectedHeads requires a runner for PR-scoped operations", () => {
  assert.throws(
    () => refreshExpectedHeads({ requests: [request()] }),
    /authority_head_refresh_runner_required/,
  );
});
