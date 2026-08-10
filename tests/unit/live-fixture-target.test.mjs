import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyGitHubRateLimit,
  isReadOnlyGitHubCommand,
  runGitHubCommandWithRetry,
} from "../../scripts/lib/github-retry.mjs";
import {
  assertFixtureRepositoryIsolation,
  fixtureRemoteName,
  fixtureRemoteUrl,
} from "../../scripts/lib/live-fixture-target.mjs";
import {
  assertFixtureTargetIdentity,
  fixtureIdentitySentinelPath,
  verifyFixtureTargetIdentity,
} from "../../scripts/lib/live-fixture-identity.mjs";

const SOURCE = "Wibias/github-delivery";
const FIXTURE = "Wibias/github-delivery-fixture";
const SOURCE_ID = 1317569489;
const FIXTURE_ID = 2000000001;

function sentinel(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "github-delivery/live-fixture-target",
    fixtureRepository: FIXTURE,
    fixtureRepositoryId: FIXTURE_ID,
    sourceRepository: SOURCE,
    sourceRepositoryId: SOURCE_ID,
    ...overrides,
  };
}

test("dedicated fixture repository is accepted", () => {
  assert.deepEqual(
    assertFixtureRepositoryIsolation({
      sourceRepo: SOURCE,
      fixtureRepo: FIXTURE,
    }),
    {
      sourceRepo: SOURCE,
      fixtureRepo: FIXTURE,
      sameRepository: false,
    },
  );
});

test("same-repository live fixture is rejected by default", () => {
  assert.throws(
    () =>
      assertFixtureRepositoryIsolation({
        sourceRepo: SOURCE,
        fixtureRepo: "wibias/GITHUB-delivery",
      }),
    /fixture_repo_must_be_separate/,
  );
});

test("same-repository fixture requires an explicit local override", () => {
  const result = assertFixtureRepositoryIsolation({
    sourceRepo: SOURCE,
    fixtureRepo: SOURCE,
    allowSameRepository: true,
  });
  assert.equal(result.sameRepository, true);
});

test("fixture repository must be explicitly identified", () => {
  assert.throws(
    () =>
      assertFixtureRepositoryIsolation({
        sourceRepo: SOURCE,
        fixtureRepo: "",
      }),
    /fixture_repo_required/,
  );
});

test("fixture git remote is deterministic and points only at the target repo", () => {
  assert.equal(fixtureRemoteName(), "github-delivery-fixture");
  assert.equal(
    fixtureRemoteUrl(FIXTURE),
    "https://github.com/Wibias/github-delivery-fixture.git",
  );
});

test("fixture identity requires exact numeric target id and target-side opt-in sentinel", () => {
  assert.deepEqual(
    assertFixtureTargetIdentity({
      sourceRepo: SOURCE,
      sourceRepoId: SOURCE_ID,
      fixtureRepo: FIXTURE,
      fixtureRepoId: FIXTURE_ID,
      expectedFixtureRepoId: FIXTURE_ID,
      sentinel: sentinel(),
    }),
    {
      sourceRepo: SOURCE,
      sourceRepoId: SOURCE_ID,
      fixtureRepo: FIXTURE,
      fixtureRepoId: FIXTURE_ID,
      expectedFixtureRepoId: FIXTURE_ID,
      sentinelPath: ".github/github-delivery-live-fixture.json",
    },
  );
  assert.equal(
    fixtureIdentitySentinelPath(),
    ".github/github-delivery-live-fixture.json",
  );
});

test("wrong writable repository id is rejected even when the repository name is different", () => {
  assert.throws(
    () =>
      assertFixtureTargetIdentity({
        sourceRepo: SOURCE,
        sourceRepoId: SOURCE_ID,
        fixtureRepo: "Wibias/unrelated-repo",
        fixtureRepoId: 999,
        expectedFixtureRepoId: FIXTURE_ID,
        sentinel: sentinel({
          fixtureRepository: "Wibias/unrelated-repo",
          fixtureRepositoryId: 999,
        }),
      }),
    /fixture_identity_id_mismatch/,
  );
});

test("fixture sentinel must opt in to this exact source repository identity", () => {
  for (const badSentinel of [
    sentinel({ sourceRepository: "other/source" }),
    sentinel({ sourceRepositoryId: SOURCE_ID + 1 }),
    sentinel({ fixtureRepository: "other/fixture" }),
    sentinel({ fixtureRepositoryId: FIXTURE_ID + 1 }),
  ]) {
    assert.throws(
      () =>
        assertFixtureTargetIdentity({
          sourceRepo: SOURCE,
          sourceRepoId: SOURCE_ID,
          fixtureRepo: FIXTURE,
          fixtureRepoId: FIXTURE_ID,
          expectedFixtureRepoId: FIXTURE_ID,
          sentinel: badSentinel,
        }),
      /fixture_identity_sentinel_/,
    );
  }
});

test("live identity verifier reads both repository ids and the target sentinel before returning", () => {
  const calls = [];
  const result = verifyFixtureTargetIdentity({
    sourceRepo: SOURCE,
    fixtureRepo: FIXTURE,
    expectedFixtureRepoId: FIXTURE_ID,
    baseBranch: "main",
    runner(command, args) {
      calls.push([command, ...args]);
      assert.equal(command, "gh");
      if (args[1] === `repos/${SOURCE}`) {
        return { status: 0, stdout: JSON.stringify({ id: SOURCE_ID }), stderr: "" };
      }
      if (args[1] === `repos/${FIXTURE}`) {
        return { status: 0, stdout: JSON.stringify({ id: FIXTURE_ID }), stderr: "" };
      }
      if (String(args[1]).includes("/contents/.github/github-delivery-live-fixture.json")) {
        return {
          status: 0,
          stdout: JSON.stringify({
            encoding: "base64",
            content: Buffer.from(JSON.stringify(sentinel())).toString("base64"),
          }),
          stderr: "",
        };
      }
      throw new Error(`unexpected: ${args.join(" ")}`);
    },
  });
  assert.equal(result.fixtureRepoId, FIXTURE_ID);
  assert.equal(calls.length, 3);
});

test("only proven read-only gh commands are retryable", () => {
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
    { rateLimited: true, delayMs: 7000, source: "retry_after" },
  );
  assert.deepEqual(
    classifyGitHubRateLimit({ status: 1, stderr: "HTTP 403 API rate limit exceeded\nx-ratelimit-reset: 200" }),
    {
      rateLimited: true,
      resetEpochSeconds: 200,
      delayMs: null,
      source: "rate_limit_reset",
    },
  );
  assert.equal(
    classifyGitHubRateLimit({ status: 1, stderr: "HTTP 403 forbidden" }).rateLimited,
    false,
  );
});

test("read-only GitHub calls retry bounded rate limits", () => {
  let attempts = 0;
  const sleeps = [];
  const result = runGitHubCommandWithRetry("gh", ["pr", "view", "42"], {
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
  });
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
