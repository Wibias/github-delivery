import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import test from "node:test";

import {
  executeMutationRequest,
  planMutationRequest,
} from "../../scripts/lib/github-mutation-broker.mjs";

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

function mergeRequest(overrides = {}) {
  return {
    schemaVersion: 1,
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

function grantPayload(overrides = {}) {
  return {
    version: 1,
    aud: "github-delivery",
    repo: "acme/widgets",
    action: "merge_pr",
    resource: {
      pr: 32,
      expectedHead: "abcdef1234567890",
    },
    maxMutationMode: "maintainer",
    explicitInstruction: true,
    issuedAt: NOW - 10,
    expiresAt: NOW + 300,
    nonce: "host-generated-1",
    ...overrides,
  };
}

function signGrant(privateKey, payload) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signed = `gd1.${encoded}`;
  const signature = sign(null, Buffer.from(signed, "ascii"), privateKey).toString("base64url");
  return `${signed}.${signature}`;
}

function trustedOptions(publicKeyPem, overrides = {}) {
  return {
    authorityPublicKey: publicKeyPem,
    authorityNow: NOW,
    ...overrides,
  };
}

test("compatibility mode labels caller assertions instead of claiming trusted provenance", () => {
  const plan = planMutationRequest(mergeRequest({ trusted: true }));
  assert.equal(plan.authorization.allowed, true);
  assert.deepEqual(plan.authority, {
    provenance: "caller_asserted",
    verified: false,
    reason: "grant_absent",
  });
});

test("a valid Ed25519 grant produces trusted_grant provenance", () => {
  const { privateKey, publicKeyPem } = keypair();
  const request = mergeRequest({
    authorityGrant: signGrant(privateKey, grantPayload()),
    explicitInstruction: false,
  });
  const plan = planMutationRequest(request, trustedOptions(publicKeyPem));
  assert.equal(plan.authorization.allowed, true);
  assert.equal(plan.authority.provenance, "trusted_grant");
  assert.equal(plan.authority.verified, true);
  assert.equal(plan.authority.reason, null);
  assert.equal(plan.authority.claims.action, "merge_pr");
  assert.equal(plan.authority.claims.repo, "acme/widgets");
  assert.equal(plan.authority.claims.nonce, "host-generated-1");
  assert.equal("token" in plan.authority, false);
  assert.equal("signature" in plan.authority, false);
});

test("trusted-only mode rejects caller assertions before any GitHub process is spawned", () => {
  let calls = 0;
  assert.throws(
    () =>
      executeMutationRequest({
        request: mergeRequest(),
        execute: true,
        requireTrustedAuthority: true,
        runner() {
          calls += 1;
          return { status: 0, stdout: "", stderr: "" };
        },
      }),
    /trusted_authority_required:grant_absent/,
  );
  assert.equal(calls, 0);
});

test("a supplied grant without a configured public key fails instead of downgrading", () => {
  const { privateKey } = keypair();
  assert.throws(
    () =>
      planMutationRequest(
        mergeRequest({ authorityGrant: signGrant(privateKey, grantPayload()) }),
      ),
    /authority_grant_invalid:public_key_missing/,
  );
});

test("malformed or badly signed grants fail closed", () => {
  const { privateKey, publicKeyPem } = keypair();
  const other = keypair();
  assert.throws(
    () =>
      planMutationRequest(
        mergeRequest({ authorityGrant: "gd1.not-json.bad" }),
        trustedOptions(publicKeyPem),
      ),
    /authority_grant_invalid:/,
  );
  assert.throws(
    () =>
      planMutationRequest(
        mergeRequest({ authorityGrant: signGrant(other.privateKey, grantPayload()) }),
        trustedOptions(publicKeyPem),
      ),
    /authority_grant_invalid:bad_signature/,
  );
  assert.doesNotThrow(() => signGrant(privateKey, grantPayload()));
});

test("signed grants are bound to audience, repo, action, resource and head", () => {
  const { privateKey, publicKeyPem } = keypair();
  const cases = [
    ["wrong_audience", { aud: "other" }],
    ["repo_mismatch", { repo: "acme/other" }],
    ["action_mismatch", { action: "close_pr" }],
    ["resource_mismatch", { resource: { pr: 99, expectedHead: "abcdef1234567890" } }],
    ["resource_mismatch", { resource: { pr: 32, expectedHead: "different" } }],
  ];
  for (const [reason, overrides] of cases) {
    const authorityGrant = signGrant(privateKey, grantPayload(overrides));
    assert.throws(
      () =>
        planMutationRequest(
          mergeRequest({ authorityGrant }),
          trustedOptions(publicKeyPem),
        ),
      new RegExp(`authority_grant_invalid:${reason}`),
    );
  }
});

test("signed grants enforce time bounds and maximum mutation mode", () => {
  const { privateKey, publicKeyPem } = keypair();
  const cases = [
    ["expired", { issuedAt: NOW - 600, expiresAt: NOW - 60 }],
    ["not_yet_valid", { issuedAt: NOW + 120, expiresAt: NOW + 300 }],
    ["ttl_exceeded", { issuedAt: NOW - 10, expiresAt: NOW + 1_200 }],
  ];
  for (const [reason, overrides] of cases) {
    assert.throws(
      () =>
        planMutationRequest(
          mergeRequest({ authorityGrant: signGrant(privateKey, grantPayload(overrides)) }),
          trustedOptions(publicKeyPem),
        ),
      new RegExp(`authority_grant_invalid:${reason}`),
    );
  }

  assert.throws(
    () =>
      planMutationRequest(
        mergeRequest({
          mutationMode: "autonomous",
          authorityGrant: signGrant(privateKey, grantPayload({ maxMutationMode: "maintainer" })),
        }),
        trustedOptions(publicKeyPem),
      ),
    /authority_grant_invalid:mutation_mode_exceeds_grant/,
  );
});

test("trusted exact-text grants bind the approved human reply body", () => {
  const { privateKey, publicKeyPem } = keypair();
  const body = "Thanks, fixed in abc1234.";
  const resource = {
    pr: 32,
    expectedHead: "abcdef1234567890",
    commentId: 77,
  };
  const payload = grantPayload({
    action: "reply_human_thread",
    resource,
    maxMutationMode: "maintainer",
    exactTextSha256: sha256(body),
  });
  const authorityGrant = signGrant(privateKey, payload);
  const request = {
    schemaVersion: 1,
    action: "reply_human_thread",
    mutationMode: "maintainer",
    exactTextConfirmed: false,
    exactTextSha256: sha256(body),
    idempotencyKey: "reply-77",
    repo: "acme/widgets",
    pr: 32,
    expectedHead: "abcdef1234567890",
    commentId: 77,
    body,
    authorityGrant,
  };

  const plan = planMutationRequest(request, trustedOptions(publicKeyPem));
  assert.equal(plan.authorization.allowed, true);
  assert.equal(plan.authority.provenance, "trusted_grant");

  assert.throws(
    () =>
      planMutationRequest(
        { ...request, body: "Changed after approval" },
        trustedOptions(publicKeyPem),
      ),
    /authority_grant_invalid:exact_text_hash_mismatch/,
  );
});
