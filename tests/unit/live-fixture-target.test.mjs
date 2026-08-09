import assert from "node:assert/strict";
import test from "node:test";

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
