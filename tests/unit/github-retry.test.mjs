import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyGitHubRateLimit,
  runGitHubCommandWithRetry,
} from "../../scripts/lib/github-retry.mjs";

function rateLimited(stderr) {
  return { status: 1, stdout: "", stderr };
}

test("classifies GitHub retry-after and reset guidance", () => {
  assert.deepEqual(
    classifyGitHubRateLimit(rateLimited("HTTP 429\nretry-after: 125")),
    { rateLimited: true, delayMs: 125_000, source: "retry_after" },
  );
  assert.deepEqual(
    classifyGitHubRateLimit(
      rateLimited("API rate limit exceeded\nx-ratelimit-reset: 2000"),
    ),
    {
      rateLimited: true,
      resetEpochSeconds: 2000,
      delayMs: null,
      source: "rate_limit_reset",
    },
  );
});

test("does not shorten a server-directed wait to the local retry budget", () => {
  const sleeps = [];
  let calls = 0;
  const result = runGitHubCommandWithRetry("gh", ["api", "repos/acme/widgets"], {
    runner() {
      calls += 1;
      return rateLimited("HTTP 429\nretry-after: 125");
    },
    sleep: (ms) => sleeps.push(ms),
    maxDelayMs: 60_000,
  });

  assert.equal(calls, 1);
  assert.deepEqual(sleeps, []);
  assert.equal(result.githubDeliveryAttempts, 1);
  assert.equal(result.githubDeliveryRetryDeferredMs, 125_000);
  assert.equal(result.githubDeliveryRetrySource, "retry_after");
});

test("does not retry before a primary reset beyond the synchronous budget", () => {
  let calls = 0;
  const result = runGitHubCommandWithRetry("gh", ["api", "repos/acme/widgets"], {
    runner() {
      calls += 1;
      return rateLimited("API rate limit exceeded\nx-ratelimit-reset: 1240");
    },
    now: () => 1_000_000,
    sleep() {
      assert.fail("must not sleep a shortened reset interval");
    },
    maxDelayMs: 60_000,
  });

  assert.equal(calls, 1);
  assert.equal(result.githubDeliveryRetryDeferredMs, 240_000);
  assert.equal(result.githubDeliveryRetrySource, "rate_limit_reset");
});

test("secondary fallback waits at least one minute before retrying", () => {
  const sleeps = [];
  let calls = 0;
  const result = runGitHubCommandWithRetry("gh", ["api", "repos/acme/widgets"], {
    runner() {
      calls += 1;
      if (calls === 1) return rateLimited("secondary rate limit");
      return { status: 0, stdout: "{}", stderr: "" };
    },
    sleep: (ms) => sleeps.push(ms),
    random: () => 0,
    maxDelayMs: 60_000,
  });

  assert.equal(result.status, 0);
  assert.equal(result.githubDeliveryAttempts, 2);
  assert.deepEqual(sleeps, [60_000]);
});

test("mutating GitHub commands are never retried automatically", () => {
  let calls = 0;
  const result = runGitHubCommandWithRetry(
    "gh",
    ["api", "repos/acme/widgets/issues", "--method", "POST"],
    {
      runner() {
        calls += 1;
        return rateLimited("HTTP 429\nretry-after: 60");
      },
      sleep() {
        assert.fail("mutation retry must not sleep");
      },
    },
  );

  assert.equal(calls, 1);
  assert.equal(result.githubDeliveryAttempts, 1);
});

test("gh api --input without GET is not retried on rate limit", () => {
  let calls = 0;
  const result = runGitHubCommandWithRetry(
    "gh",
    ["api", "repos/acme/widgets/issues/1", "--input", "-"],
    {
      runner() {
        calls += 1;
        return rateLimited("HTTP 429\nretry-after: 60");
      },
      sleep() {
        assert.fail("stdin-body retry must not sleep");
      },
    },
  );

  assert.equal(calls, 1);
  assert.equal(result.githubDeliveryAttempts, 1);
});
