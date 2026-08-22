import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";

import { classifyAuthority, verifyAuthorityGrant } from "../../scripts/lib/authority-grant.mjs";

const NOW = 1_786_150_000;

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    privateKey,
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
  };
}

function request(overrides = {}) {
  return {
    action: "merge_pr",
    mutationMode: "maintainer",
    explicitInstruction: true,
    repo: "acme/widgets",
    pr: 32,
    expectedHead: "abcdef1234567890",
    expectedBase: "main",
    expectedBaseOid: "b".repeat(40),
    mergeMethod: "merge",
    ...overrides,
  };
}

function payload(overrides = {}) {
  return {
    version: 1,
    aud: "github-delivery",
    repo: "acme/widgets",
    action: "merge_pr",
    resource: { pr: 32, expectedHead: "abcdef1234567890" },
    maxMutationMode: "maintainer",
    explicitInstruction: true,
    issuedAt: NOW - 10,
    expiresAt: NOW + 300,
    nonce: "legacy-1",
    ...overrides,
  };
}

function signGrant(privateKey, claims) {
  const encoded = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signed = `gd1.${encoded}`;
  const signature = sign(null, Buffer.from(signed, "ascii"), privateKey).toString("base64url");
  return `${signed}.${signature}`;
}

test("legacy Ed25519 token without alg or kid still verifies through publicKey", () => {
  const { privateKey, publicKeyPem } = keypair();
  const result = verifyAuthorityGrant({
    token: signGrant(privateKey, payload()),
    publicKey: publicKeyPem,
    request: request(),
    now: NOW,
  });
  assert.equal(result.verified, true);
  assert.equal(result.claims.nonce, "legacy-1");
  assert.equal("alg" in result.claims, false);
});

test("legacy missing grant remains caller asserted in compatibility mode", () => {
  const result = classifyAuthority({ request: request() });
  assert.equal(result.verified, false);
  assert.equal(result.provenance, "caller_asserted");
  assert.equal(result.reason, "grant_absent");
});

test("legacy trusted-only mode still rejects an absent grant", () => {
  assert.throws(
    () => classifyAuthority({ request: request(), requireTrusted: true }),
    /trusted_authority_required:grant_absent/,
  );
});

test("legacy human reply exact text remains bound", () => {
  const { privateKey, publicKeyPem } = keypair();
  const body = "Thanks, fixed.";
  const claims = payload({
    action: "reply_human_thread",
    resource: { pr: 32, expectedHead: "abcdef1234567890", commentId: 77 },
    maxMutationMode: "review",
    exactTextSha256: sha256(body),
  });
  const req = request({
    action: "reply_human_thread",
    mutationMode: "review",
    commentId: 77,
    body,
    exactTextSha256: sha256(body),
  });
  const token = signGrant(privateKey, claims);
  assert.equal(verifyAuthorityGrant({ token, publicKey: publicKeyPem, request: req, now: NOW }).verified, true);
  assert.equal(
    verifyAuthorityGrant({ token, publicKey: publicKeyPem, request: { ...req, body: "changed" }, now: NOW }).reason,
    "exact_text_hash_mismatch",
  );
});
