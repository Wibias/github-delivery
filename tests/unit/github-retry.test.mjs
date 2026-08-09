import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyGitHubRateLimit,
  isReadOnlyGitHubCommand,
  runGitHubCommandWithRetry,
} from "../../scripts/lib/github-retry.mjs";

test("classifies only proven read-only gh commands as retryable", () => {
  assert.equal(isReadOnlyGitHubCommand("gh", ["pr", "view", "42"]), true);
  assert.equal(isReadOnlyGitHubCommand("gh", ["api", "repos/acme/widgets"]), true);
  assert.equal(
    isReadOnlyGitHubCommand("gh", ["api", "-X", "GET", "repos/acme/widgets/actions/runs", "-f", "per_page=100"]),
    true,
  );
  assert.equal(
    isReadOnlyGitHubCommand("gh", ["api", "repos/acme/widgets/issues", "-f", "title=x"]),
    false,
  );
  assert.equal(
    isReadOnlyGitHubCommand("gh", ["api", "graphql", "-f", "query=mutation { x }"]),
    false,
  );
  assert.equal(isReadOnlyGitHubCommand("gh", ["pr", "comment", "42"]), false);
});

test("rate-limit classifier honours Retry-After and reset metadata", () => {
  assert.deepEqual(
    classifyGitHubRateLimit({ status: 1, stderr: "HTTP 429\nRetry-After: 7" }),
    { rateLimited: true, delayMs: 7000 },
  );
  assert.deepEqual(
    classifyGitHubRateLimit({ status: 1, stderr: "HTTP 403 API rate limit exceeded\nx-ratelimit-reset: 200" }),
    { rateLimited: true, resetEpochSeconds: 200, delayMs: null },
  );
  assert.equal(
    classifyGitHubRateLimit({ status: 1, stderr: "HTTP 403 forbidden" }).rateLimited,
    false,
  );
});

test("read-only GitHub calls retry bounded rate limits", () => {
  let attempts = 0;
  const sleeps = [];
  const result = runGitHubCommandWithRetry(
    "gh",
    ["pr", "view", "42"],
    {
      maxAttempts: 3,
      sleep(ms) {
        sleeps.push(ms);
      },
      runner() {
        attempts += 1;
        if (attempts < 3) {
          return { status: 1, stdout: "", stderr: "HTTP 429 Retry-After: 2" };
        }
        return { status: 0, stdout: "ok", stderr: "" };
      },
    },
  );
  assert.equal(result.status, 0);
  assert.equal(result.githubDeliveryAttempts, 3);
  assert.deepEqual(sleeps, [2000, 2000]);
});

test("write or ambiguous GitHub calls never retry an unknown outcome", () => {
  for (const args of [
    ["pr", "comment", "42", "--body", "x"],
    ["api", "repos/acme/widgets/issues", "-f", "title=x"],
  ]) {
    let attempts = 0;
    const result = runGitHubCommandWithRetry("gh", args, {
      maxAttempts: 3,
      sleep() {
        throw new Error("write must not sleep for retry");
      },
      runner() {
        attempts += 1;
        return { status: 1, stdout: "", stderr: "HTTP 429 Retry-After: 2" };
      },
    });
    assert.equal(result.status, 1);
    assert.equal(result.githubDeliveryAttempts, 1);
    assert.equal(attempts, 1);
  }
});
