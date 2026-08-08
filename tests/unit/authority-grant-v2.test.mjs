import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";

import { authorityScopeSha256 } from "../../scripts/lib/authority-scope.mjs";
import { verifyAuthorityGrant } from "../../scripts/lib/authority-grant.mjs";

const NOW = 1_786_170_000;
const request = {
  schemaVersion: 1,
  action: "merge_pr",
  mutationMode: "maintainer",
  repo: "Wibias/github-delivery",
  pr: 105,
  expectedHead: "71ac000000000000000000000000000000000001",
  mergeMethod: "merge",
};

function basePayload(overrides = {}) {
  return {
    version: 1,
    alg: "ES256",
    kid: "win-tpm-test-01",
    aud: "github-delivery",
    repo: request.repo,
    action: request.action,
    resource: { pr: request.pr, expectedHead: request.expectedHead },
    scopeSha256: authorityScopeSha256(request),
    batchId: "bch_test",
    batchIndex: 0,
    batchSha256: "1".repeat(64),
    maxMutationMode: "maintainer",
    explicitInstruction: true,
    issuedAt: NOW - 5,
    expiresAt: NOW + 55,
    nonce: "gnt_test",
    redemption: "required",
    ...overrides,
  };
}

function es256Keypair() {
  return generateKeyPairSync("ec", { namedCurve: "P-256" });
}

function signEs256(privateKey, payload) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const prefix = `gd1.${encoded}`;
  const signature = sign("sha256", Buffer.from(prefix, "ascii"), {
    key: privateKey,
    dsaEncoding: "der",
  }).toString("base64url");
  return `${prefix}.${signature}`;
}

function trustStore(publicKey) {
  return {
    schemaVersion: 1,
    keys: [{
      kid: "win-tpm-test-01",
      alg: "ES256",
      publicKey: publicKey.export({ type: "spki", format: "pem" }),
      status: "active",
      requireScopeHash: true,
      requireRedemption: true,
    }],
  };
}

test("ES256 grants verify through a kid-selected trust store key", () => {
  const { publicKey, privateKey } = es256Keypair();
  const result = verifyAuthorityGrant({
    token: signEs256(privateKey, basePayload()),
    trustStore: trustStore(publicKey),
    request,
    now: NOW,
  });
  assert.equal(result.verified, true);
  assert.equal(result.provenance, "trusted_grant");
  assert.equal(result.claims.alg, "ES256");
  assert.equal(result.claims.kid, "win-tpm-test-01");
  assert.equal(result.claims.redemption, "required");
});

test("ES256 scope hash binds parameters not covered by legacy resource fields", () => {
  const { publicKey, privateKey } = es256Keypair();
  const token = signEs256(privateKey, basePayload());
  const result = verifyAuthorityGrant({
    token,
    trustStore: trustStore(publicKey),
    request: { ...request, mergeMethod: "squash" },
    now: NOW,
  });
  assert.equal(result.verified, false);
  assert.equal(result.reason, "scope_mismatch");
});

test("unknown algorithms and unknown kids fail closed", () => {
  const { publicKey, privateKey } = es256Keypair();
  let result = verifyAuthorityGrant({
    token: signEs256(privateKey, basePayload({ alg: "RS256" })),
    trustStore: trustStore(publicKey),
    request,
    now: NOW,
  });
  assert.equal(result.verified, false);
  assert.equal(result.reason, "algorithm_unsupported");

  result = verifyAuthorityGrant({
    token: signEs256(privateKey, basePayload({ kid: "missing" })),
    trustStore: trustStore(publicKey),
    request,
    now: NOW,
  });
  assert.equal(result.verified, false);
  assert.equal(result.reason, "key_not_found");
});

test("retired trust-store keys are rejected", () => {
  const { publicKey, privateKey } = es256Keypair();
  const store = trustStore(publicKey);
  store.keys[0].status = "retired";
  const result = verifyAuthorityGrant({
    token: signEs256(privateKey, basePayload()),
    trustStore: store,
    request,
    now: NOW,
  });
  assert.equal(result.verified, false);
  assert.equal(result.reason, "key_retired");
});

test("broker compatibility slot accepts a trust-store object as authorityPublicKey", () => {
  const { publicKey, privateKey } = es256Keypair();
  const store = trustStore(publicKey);
  const result = verifyAuthorityGrant({
    token: signEs256(privateKey, basePayload()),
    publicKey: store,
    request,
    now: NOW,
  });
  assert.equal(result.verified, true);
  assert.equal(result.claims.kid, "win-tpm-test-01");
});
