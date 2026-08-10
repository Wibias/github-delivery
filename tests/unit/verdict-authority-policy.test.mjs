import assert from "node:assert/strict";
import test from "node:test";

import { verdictAuthorityPolicy } from "../../scripts/lib/verdict-authority-policy.mjs";

test("live verdict publication skips OS-backed provenance when authority mode is off", () => {
  assert.deepEqual(
    verdictAuthorityPolicy({
      offlineFixture: false,
      authorityPublicKeyFile: null,
      env: {},
      config: { schemaVersion: 1, authorityMode: "off" },
    }),
    {
      authorityMode: "off",
      enforceProvenance: false,
      reason: "trusted_authority_disabled_by_user_config",
    },
  );
});

test("live verdict publication requires provenance in high-assurance and all modes", () => {
  for (const authorityMode of ["high-assurance", "all"]) {
    assert.deepEqual(
      verdictAuthorityPolicy({
        offlineFixture: false,
        authorityPublicKeyFile: null,
        env: {},
        config: { schemaVersion: 1, authorityMode },
      }),
      {
        authorityMode,
        enforceProvenance: true,
        reason: "trusted_authority_required_by_user_config",
      },
    );
  }
});

test("offline format fixtures remain provenance-neutral without a verifier", () => {
  assert.deepEqual(
    verdictAuthorityPolicy({
      offlineFixture: true,
      authorityPublicKeyFile: null,
      env: {},
      config: { schemaVersion: 1, authorityMode: "all" },
    }),
    {
      authorityMode: "all",
      enforceProvenance: false,
      reason: "offline_fixture_provenance_not_checked",
    },
  );
});

test("offline security fixtures with an explicit verifier stay strict regardless of user mode", () => {
  assert.deepEqual(
    verdictAuthorityPolicy({
      offlineFixture: true,
      authorityPublicKeyFile: "authority.pem",
      env: {},
      config: { schemaVersion: 1, authorityMode: "off" },
    }),
    {
      authorityMode: "off",
      enforceProvenance: true,
      reason: "offline_fixture_explicit_authority_verifier",
    },
  );
});

test("legacy strict environment still requires live verdict provenance", () => {
  assert.deepEqual(
    verdictAuthorityPolicy({
      offlineFixture: false,
      authorityPublicKeyFile: null,
      env: { GITHUB_DELIVERY_REQUIRE_TRUSTED_AUTHORITY: "1" },
      config: { schemaVersion: 1, authorityMode: "off" },
    }),
    {
      authorityMode: "all",
      enforceProvenance: true,
      reason: "trusted_authority_required_by_user_config",
    },
  );
});
