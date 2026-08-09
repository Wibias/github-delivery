import assert from "node:assert/strict";
import test from "node:test";

import {
  assertFixtureRepositoryIsolation,
  fixtureRemoteName,
  fixtureRemoteUrl,
} from "../../scripts/lib/live-fixture-target.mjs";

test("dedicated fixture repository is accepted", () => {
  assert.deepEqual(
    assertFixtureRepositoryIsolation({
      sourceRepo: "Wibias/github-delivery",
      fixtureRepo: "Wibias/github-delivery-fixture",
    }),
    {
      sourceRepo: "Wibias/github-delivery",
      fixtureRepo: "Wibias/github-delivery-fixture",
      sameRepository: false,
    },
  );
});

test("same-repository live fixture is rejected by default", () => {
  assert.throws(
    () =>
      assertFixtureRepositoryIsolation({
        sourceRepo: "Wibias/github-delivery",
        fixtureRepo: "wibias/GITHUB-delivery",
      }),
    /fixture_repo_must_be_separate/,
  );
});

test("same-repository fixture requires an explicit local override", () => {
  const result = assertFixtureRepositoryIsolation({
    sourceRepo: "Wibias/github-delivery",
    fixtureRepo: "Wibias/github-delivery",
    allowSameRepository: true,
  });
  assert.equal(result.sameRepository, true);
});

test("fixture repository must be explicitly identified", () => {
  assert.throws(
    () =>
      assertFixtureRepositoryIsolation({
        sourceRepo: "Wibias/github-delivery",
        fixtureRepo: "",
      }),
    /fixture_repo_required/,
  );
});

test("fixture git remote is deterministic and points only at the target repo", () => {
  assert.equal(fixtureRemoteName(), "github-delivery-fixture");
  assert.equal(
    fixtureRemoteUrl("Wibias/github-delivery-fixture"),
    "https://github.com/Wibias/github-delivery-fixture.git",
  );
});
