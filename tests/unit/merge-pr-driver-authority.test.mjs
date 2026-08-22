import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeMergeRequests,
  buildMergeRequest,
  buildThankRequest,
} from "../../scripts/merge-pr-driver.mjs";

const HEAD = "a".repeat(40);

test("merge driver attaches one trusted grant to every exact transaction request", () => {
  const requests = [
    {
      name: "merge",
      request: buildMergeRequest({
        repo: "acme/widget",
        pr: 42,
        expectedHead: HEAD,
        expectedBase: "main",
        expectedBaseOid: HEAD.replace(/a/g, "b"),
        mergeMethod: "merge",
      }),
    },
    {
      name: "post_merge_thanks",
      request: buildThankRequest({
        repo: "acme/widget",
        pr: 42,
        expectedHead: HEAD,
        body: "Thanks @alice - merged successfully.",
      }),
    },
  ];
  let authorizedOperations = null;
  const batch = authorizeMergeRequests(requests, {
    pipeName: "test-pipe",
    authorize(operations, options) {
      authorizedOperations = structuredClone(operations);
      assert.equal(options.pipeName, "test-pipe");
      return {
        batchId: "bch_test",
        expiresAt: 1234,
        grants: operations.map((_, operation) => ({
          operation,
          token: `gd1.test-${operation}.signature`,
        })),
      };
    },
  });

  assert.deepEqual(authorizedOperations, requests.map((entry) => entry.request));
  assert.equal(batch.batchId, "bch_test");
  assert.equal(batch.expiresAt, 1234);
  assert.equal(batch.requests.length, 2);
  assert.equal(batch.requests[0].request.authorityGrant, "gd1.test-0.signature");
  assert.equal(batch.requests[1].request.authorityGrant, "gd1.test-1.signature");
  assert.deepEqual(
    batch.requests.map((entry) => entry.name),
    ["merge", "post_merge_thanks"],
  );
});

test("merge driver refuses to authorize an empty transaction", () => {
  assert.throws(
    () => authorizeMergeRequests([], { authorize() { throw new Error("must not run"); } }),
    /merge_authority_requests_required/,
  );
});
