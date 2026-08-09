import assert from "node:assert/strict";
import test from "node:test";

import {
  authorityBatchSha256,
  authorityScopeForRequest,
  authorityScopeSha256,
  canonicalJson,
} from "../../scripts/lib/authority-scope.mjs";

const merge = {
  schemaVersion: 1,
  action: "merge_pr",
  mutationMode: "maintainer",
  explicitInstruction: true,
  repo: "Wibias/github-delivery",
  pr: 105,
  expectedHead: "71ac000000000000000000000000000000000001",
  mergeMethod: "merge",
};

test("canonical JSON sorts object keys recursively while preserving array order", () => {
  assert.equal(
    canonicalJson({ z: 1, a: { y: 2, x: [3, { b: true, a: false }] } }),
    '{"a":{"x":[3,{"a":false,"b":true}],"y":2},"z":1}',
  );
});

test("merge authority scope binds method and exact head", () => {
  const scope = authorityScopeForRequest(merge);
  assert.deepEqual(scope, {
    action: "merge_pr",
    expectedHead: "71ac000000000000000000000000000000000001",
    mergeMethod: "merge",
    mutationMode: "maintainer",
    pr: 105,
    repo: "Wibias/github-delivery",
  });
  assert.equal(
    authorityScopeSha256(merge),
    "5792e06b57c2f0eece1cdc227d4ccb0b75012bb9ed65bbf183e3bd994aaeb8b8",
  );
  assert.notEqual(
    authorityScopeSha256(merge),
    authorityScopeSha256({ ...merge, mergeMethod: "squash" }),
  );
});

test("push authority scope binds repository remote, exact generation, new tip, and rewrite flag", () => {
  const request = {
    schemaVersion: 1,
    action: "push_code",
    mutationMode: "maintainer",
    explicitInstruction: true,
    repo: "Wibias/github-delivery",
    remote: "origin",
    branch: "feature/safe",
    expectedRemoteTip: "a".repeat(40),
    newTip: "b".repeat(40),
    forceWithLease: true,
  };
  assert.deepEqual(authorityScopeForRequest(request), {
    action: "push_code",
    mutationMode: "maintainer",
    repo: "Wibias/github-delivery",
    remote: "origin",
    branch: "feature/safe",
    expectedRemoteTip: "a".repeat(40),
    newTip: "b".repeat(40),
    forceWithLease: true,
  });
  assert.notEqual(
    authorityScopeSha256(request),
    authorityScopeSha256({ ...request, newTip: "c".repeat(40) }),
  );
  assert.notEqual(
    authorityScopeSha256(request),
    authorityScopeSha256({ ...request, branch: "feature/other" }),
  );
});

test("PR creation scope binds exact content, topology, and idempotency key", () => {
  const request = {
    schemaVersion: 1,
    action: "create_pr",
    mutationMode: "maintainer",
    explicitInstruction: true,
    repo: "Wibias/github-delivery",
    base: "main",
    head: "feature/safe",
    draft: true,
    idempotencyKey: "create-pr-feature-safe",
    title: "Fix safe lifecycle",
    body: "Body",
  };
  const scope = authorityScopeForRequest(request);
  assert.equal(scope.base, "main");
  assert.equal(scope.head, "feature/safe");
  assert.equal(scope.draft, true);
  assert.match(scope.titleSha256, /^[0-9a-f]{64}$/);
  assert.match(scope.bodySha256, /^[0-9a-f]{64}$/);
  assert.equal("title" in scope, false);
  assert.equal("body" in scope, false);
});

test("social writes bind exact visible content and idempotency key", () => {
  const request = {
    schemaVersion: 1,
    action: "post_comment",
    mutationMode: "review",
    repo: "Wibias/github-delivery",
    pr: 105,
    expectedHead: merge.expectedHead,
    idempotencyKey: "ship-105-final",
    body: "All checks are green. Merging.",
  };
  const scope = authorityScopeForRequest(request);
  assert.match(scope.bodySha256, /^[0-9a-f]{64}$/);
  assert.equal("body" in scope, false);
  assert.notEqual(
    authorityScopeSha256(request),
    authorityScopeSha256({ ...request, body: "Changed after approval" }),
  );
});

test("reviewer order is canonicalized as an effect-equivalent set", () => {
  const base = {
    schemaVersion: 1,
    action: "request_reviewers",
    mutationMode: "maintainer",
    repo: "Wibias/github-delivery",
    pr: 105,
    expectedHead: merge.expectedHead,
  };
  assert.equal(
    authorityScopeSha256({ ...base, reviewers: ["alice", "bob"] }),
    authorityScopeSha256({ ...base, reviewers: ["bob", "alice"] }),
  );
});

test("trusted branch deletion scope requires an explicit target repository", () => {
  assert.throws(
    () => authorityScopeForRequest({
      schemaVersion: 1,
      action: "delete_head_branch",
      mutationMode: "maintainer",
      repo: "upstream/project",
      pr: 12,
      headRefName: "feature/x",
    }),
    /authority_scope_target_repo_required/,
  );
});

test("batch hash is ordered and changes when operation order changes", () => {
  const comment = {
    schemaVersion: 1,
    action: "post_comment",
    mutationMode: "review",
    repo: "Wibias/github-delivery",
    pr: 105,
    expectedHead: merge.expectedHead,
    idempotencyKey: "ship-105-final",
    body: "All checks are green. Merging.",
  };
  assert.notEqual(
    authorityBatchSha256([comment, merge]),
    authorityBatchSha256([merge, comment]),
  );
});
