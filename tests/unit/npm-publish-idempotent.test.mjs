import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PUBLISH_VERIFY_DELAYS_MS,
  verifyPublishedPackageIntegrity,
} from "../../scripts/publish-npm-idempotent.mjs";

const SPEC = "github-delivery@0.8.0";
const INTEGRITY = "sha512-expected";

test("post-publish verification retries missing registry metadata until integrity appears", () => {
  const observed = [null, null, INTEGRITY];
  const sleeps = [];
  const result = verifyPublishedPackageIntegrity({
    npmCli: "npm-cli.js",
    spec: SPEC,
    expectedIntegrity: INTEGRITY,
    delaysMs: [10, 20, 30],
    sleep: (milliseconds) => sleeps.push(milliseconds),
    lookup: () => observed.shift(),
  });

  assert.equal(result, INTEGRITY);
  assert.deepEqual(sleeps, [10, 20]);
});

test("post-publish verification fails immediately on a visible integrity mismatch", () => {
  const sleeps = [];
  assert.throws(
    () => verifyPublishedPackageIntegrity({
      npmCli: "npm-cli.js",
      spec: SPEC,
      expectedIntegrity: INTEGRITY,
      delaysMs: [10, 20],
      sleep: (milliseconds) => sleeps.push(milliseconds),
      lookup: () => "sha512-different",
    }),
    /npm_publish_verification_failed:github-delivery@0\.8\.0: expected sha512-expected, observed sha512-different/,
  );
  assert.deepEqual(sleeps, []);
});

test("post-publish verification remains fail-visible after the bounded visibility window", () => {
  const sleeps = [];
  assert.throws(
    () => verifyPublishedPackageIntegrity({
      npmCli: "npm-cli.js",
      spec: SPEC,
      expectedIntegrity: INTEGRITY,
      delaysMs: [10, 20],
      sleep: (milliseconds) => sleeps.push(milliseconds),
      lookup: () => null,
    }),
    /npm_publish_verification_failed:github-delivery@0\.8\.0: expected sha512-expected, observed missing/,
  );
  assert.deepEqual(sleeps, [10, 20]);
});

test("default propagation retry budget is bounded to one minute", () => {
  assert.equal(
    DEFAULT_PUBLISH_VERIFY_DELAYS_MS.reduce((sum, delay) => sum + delay, 0),
    60_000,
  );
});
