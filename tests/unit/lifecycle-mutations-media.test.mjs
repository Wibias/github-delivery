import assert from "node:assert/strict";
import test from "node:test";

import { preflightLifecycleMutation, validateLifecycleMutation } from "../../scripts/lib/lifecycle-mutations.mjs";

const HEAD = "a".repeat(40);

function bodyRunner({ head = HEAD, body = "![shot](https://example.com/shot.png)" } = {}) {
  return (command, args) => {
    assert.equal(command, "gh");
    assert.deepEqual(args.slice(0, 3), ["pr", "view", "12"]);
    assert.ok(args.includes("headRefOid,body"));
    return { status: 0, stdout: JSON.stringify({ headRefOid: head, body }), stderr: "" };
  };
}

function request(overrides = {}) {
  return {
    action: "update_pr_body",
    repo: "Wibias/github-delivery",
    pr: 12,
    expectedHead: HEAD,
    body: "New text\n![shot](https://example.com/shot.png)",
    ...overrides,
  };
}

test("update_pr_body accepts an optional exact media-removal identity list", () => {
  assert.equal(validateLifecycleMutation(request({ approvedMediaRemovals: ["https://example.com/old.png"] })), true);
  assert.throws(() => validateLifecycleMutation(request({ approvedMediaRemovals: "all" })), /approved_media_removals_invalid/);
  assert.throws(() => validateLifecycleMutation(request({ approvedMediaRemovals: [""] })), /approved_media_removal_invalid/);
});

test("re-reads the current head and body before allowing a body update", () => {
  assert.doesNotThrow(() => preflightLifecycleMutation({ request: request(), runner: bodyRunner() }));
});

test("blocks body mutation when the observed PR head changed", () => {
  assert.throws(
    () => preflightLifecycleMutation({ request: request(), runner: bodyRunner({ head: "b".repeat(40) }) }),
    /expected_head_mismatch/,
  );
});

test("blocks accidental loss of existing PR media", () => {
  assert.throws(
    () => preflightLifecycleMutation({ request: request({ body: "New text only" }), runner: bodyRunner() }),
    /pr_body_media_removal_unapproved:https:\/\/example\.com\/shot\.png/,
  );
});

test("allows an exact explicitly approved media removal", () => {
  assert.doesNotThrow(() => preflightLifecycleMutation({
    request: request({
      body: "New text only",
      approvedMediaRemovals: ["https://example.com/shot.png"],
    }),
    runner: bodyRunner(),
  }));
});
