import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { authorityScopeSha256 } from "../../scripts/lib/authority-scope.mjs";
import { mergeReviewEvidenceForSnapshot } from "../../scripts/lib/merge-review-evidence.mjs";
import { stampReviewVerdictRequest } from "../../scripts/lib/review-verdict-marker.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const COMMAND = join(ROOT, "scripts", "verify-verdict-published.mjs");
const RUN_ID = "fr-42-provenance";
const HEAD = "0123456789abcdef0123456789abcdef01234567";
const CREATED_AT = "2026-08-09T17:00:00Z";
const NOW = Math.floor(Date.parse(CREATED_AT) / 1000);

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function verdictBody() {
  return [
    "## [GD] Verdict: approve-comment",
    `<!-- github-delivery:full-review-verdict run:${RUN_ID} head:${HEAD} -->`,
    "",
    "### TLDR",
    "",
    "- **PR:** `#42` — widget",
    "- **Head:** `abc1234` on `dev`",
    "- **Decision:** useful and ready",
    "- **Usefulness:** fixes a real bug",
    "- **Bugs:** none blocking",
    "- **Security:** none",
    "- **Spec / standards:** clean",
    "- **Reviews:** humans + bots clear",
    "- **Base / CI:** green",
    "- **Gate:** none",
    "- **Owner actions (foreign PR):** none",
    "- **Bottom line:** ship it",
    "",
    "<details>",
    "<summary><b>Full verdict</b></summary>",
    "",
    "full detail",
    "",
    "</details>",
  ].join("\n");
}

function signGrant(privateKey, payload) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signed = `gd1.${encoded}`;
  const signature = sign(null, Buffer.from(signed, "ascii"), privateKey).toString("base64url");
  return `${signed}.${signature}`;
}

function trustedVerdictFixture({
  login = "Wibias",
  body = verdictBody(),
  tamper = null,
  authorityBranch = null,
  resourceBranch = authorityBranch,
  scopeBranch = authorityBranch,
  scopePr = 42,
  grantHead = HEAD,
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), "github-delivery-verdict-provenance-"));
  const commentsPath = join(directory, "comments.json");
  const publicKeyPath = join(directory, "authority.pem");
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  writeFileSync(publicKeyPath, publicKey.export({ type: "spki", format: "pem" }), "utf8");

  const request = {
    schemaVersion: 1,
    action: "post_comment",
    mutationMode: "review",
    repo: "acme/widget",
    pr: 42,
    expectedHead: grantHead,
    idempotencyKey: "full-review-42-provenance",
    body,
    ...(authorityBranch ? { authorityBranch } : {}),
  };
  const scopeRequest = { ...request, pr: scopePr };
  if (scopeBranch) scopeRequest.authorityBranch = scopeBranch;
  else delete scopeRequest.authorityBranch;
  const payload = {
    version: 1,
    aud: "github-delivery",
    repo: request.repo,
    action: request.action,
    resource: {
      pr: request.pr,
      expectedHead: grantHead,
      ...(resourceBranch ? { authorityBranch: resourceBranch } : {}),
    },
    scopeSha256: authorityScopeSha256(scopeRequest),
    maxMutationMode: "review",
    explicitInstruction: false,
    issuedAt: NOW - 10,
    expiresAt: NOW + 60,
    nonce: "review-verdict-provenance-1",
    redemption: "required",
    approvalMethod: "windows_hello",
  };
  const authorityGrant = signGrant(privateKey, payload);
  const stamped = stampReviewVerdictRequest({ ...request, authorityGrant });
  const publishedBody = `${tamper ? tamper(stamped.body) : stamped.body}\n\n<!-- github-delivery:idempotency ${sha256(request.idempotencyKey)} -->`;
  writeFileSync(
    commentsPath,
    JSON.stringify([
      {
        id: 123,
        html_url: "https://github.com/acme/widget/pull/42#issuecomment-123",
        created_at: CREATED_AT,
        user: { login },
        body: publishedBody,
      },
    ]),
    "utf8",
  );
  return { commentsPath, publicKeyPath };
}

function unsignedFixture(login = "Wibias") {
  const directory = mkdtempSync(join(tmpdir(), "github-delivery-verdict-unsigned-"));
  const commentsPath = join(directory, "comments.json");
  const publicKeyPath = join(directory, "authority.pem");
  const { publicKey } = generateKeyPairSync("ed25519");
  writeFileSync(publicKeyPath, publicKey.export({ type: "spki", format: "pem" }), "utf8");
  writeFileSync(
    commentsPath,
    JSON.stringify([
      {
        id: 123,
        created_at: CREATED_AT,
        user: { login },
        body: verdictBody(),
      },
    ]),
    "utf8",
  );
  return { commentsPath, publicKeyPath };
}

function run({ commentsPath, publicKeyPath }, publisher = "Wibias", head = HEAD) {
  return spawnSync(
    process.execPath,
    [
      COMMAND,
      "acme/widget",
      "42",
      "--run-id",
      RUN_ID,
      "--head",
      head,
      "--comments-file",
      commentsPath,
      "--publisher-login",
      publisher,
      "--authority-public-key-file",
      publicKeyPath,
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
}

test("rejects a format-valid trusted verdict published by the wrong actor", () => {
  const result = run(trustedVerdictFixture({ login: "mallory" }));
  assert.equal(result.status, 1, result.stderr + result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.published, false);
  assert.equal(output.expectedPublisher, "Wibias");
  assert.equal(output.ignoredUntrustedComments, 1);
  assert.equal(output.reason, "verdict_not_published");
});

test("accepts a same-head verdict only when trusted authority approved the exact scope", () => {
  const result = run(trustedVerdictFixture());
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.published, true);
  assert.equal(output.trusted, true);
  assert.equal(output.author, "Wibias");
  assert.equal(output.expectedPublisher, "Wibias");
  assert.equal(output.provenance.authority.claims.approvalMethod, "windows_hello");
  assert.equal(output.provenance.authority.claims.redemption, "required");
  assert.equal(output.provenance.authority.claims.resource.authorityBranch, undefined);
  assert.equal(
    output.provenance.authority.claims.scopeSha256,
    authorityScopeSha256({
      schemaVersion: 1,
      action: "post_comment",
      mutationMode: "review",
      repo: "acme/widget",
      pr: 42,
      expectedHead: HEAD,
      idempotencyKey: "full-review-42-provenance",
      body: verdictBody(),
    }),
  );
});

test("accepts a branch-bound grant and reconstructs its signed scope", () => {
  const result = run(trustedVerdictFixture({ authorityBranch: "feature/audit" }));
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.trusted, true);
  assert.equal(output.provenance.authority.claims.resource.authorityBranch, "feature/audit");
  assert.equal(
    output.provenance.authority.claims.scopeSha256,
    authorityScopeSha256({
      schemaVersion: 1,
      action: "post_comment",
      mutationMode: "review",
      repo: "acme/widget",
      pr: 42,
      expectedHead: HEAD,
      idempotencyKey: "full-review-42-provenance",
      body: verdictBody(),
      authorityBranch: "feature/audit",
    }),
  );
});

test("merge review evidence accepts a branch-bound trusted verdict", () => {
  const fixture = trustedVerdictFixture({
    authorityBranch: "feature/audit",
    body: `${verdictBody()}\n`,
  });
  const comments = JSON.parse(readFileSync(fixture.commentsPath, "utf8"));
  const evidence = mergeReviewEvidenceForSnapshot(
    {
      repo: "acme/widget",
      pr: 42,
      headOid: HEAD,
      evidence: {
        viewer: { login: "Wibias" },
        feedback: { issueComments: comments },
        pullRequest: { headRefName: "feature/audit" },
      },
    },
    { authorityVerifier: readFileSync(fixture.publicKeyPath, "utf8") },
  );
  assert.equal(evidence.label, "approve-comment");
  assert.match(evidence.authorityScopeSha256, /^[0-9a-f]{64}$/);
});

test("preserves the approved body exactly through review-authority stamping", () => {
  const result = run(
    trustedVerdictFixture({
      authorityBranch: "feature/audit",
      body: `${verdictBody()}\n`,
    }),
  );
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.trusted, true);
});

test("rejects a branch-bound scope when the signed resource omits the branch", () => {
  const result = run(
    trustedVerdictFixture({
      authorityBranch: null,
      resourceBranch: null,
      scopeBranch: "feature/audit",
    }),
  );
  assert.equal(result.status, 1, result.stderr + result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.trusted, false);
  assert.match(output.reason, /review_authority_invalid:scope_mismatch/);
});

test("rejects a signed resource branch that differs from the signed scope", () => {
  const result = run(
    trustedVerdictFixture({
      authorityBranch: "feature/other",
      resourceBranch: "feature/other",
      scopeBranch: "feature/audit",
    }),
  );
  assert.equal(result.status, 1, result.stderr + result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.trusted, false);
  assert.match(output.reason, /review_authority_invalid:scope_mismatch/);
});

test("rejects a branch-bound verdict whose grant binds a different head", () => {
  const result = run(
    trustedVerdictFixture({ authorityBranch: "feature/audit", grantHead: "f".repeat(40) }),
  );
  assert.equal(result.status, 1, result.stderr + result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.published, true);
  assert.equal(output.trusted, false);
  assert.match(output.reason, /review_authority_invalid:resource_mismatch/);
});

test("rejects a grant scoped to another pull request", () => {
  const result = run(
    trustedVerdictFixture({ authorityBranch: "feature/audit", scopePr: 99 }),
  );
  assert.equal(result.status, 1, result.stderr + result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.trusted, false);
  assert.match(output.reason, /review_authority_invalid:scope_mismatch/);
});

test("rejects a verdict whose signed grant signature was tampered", () => {
  const result = run(
    trustedVerdictFixture({
      authorityBranch: "feature/audit",
      tamper(body) {
        return body.replace(
          /(gd1\.[A-Za-z0-9_-]+\.)([A-Za-z0-9_-])/,
          (match, prefix, first) => `${prefix}${first === "A" ? "B" : "A"}`,
        );
      },
    }),
  );
  assert.equal(result.status, 1, result.stderr + result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.trusted, false);
  assert.match(output.reason, /review_authority_invalid:bad_signature/);
});

test("rejects a same-actor format-valid verdict without authority provenance", () => {
  const result = run(unsignedFixture());
  assert.equal(result.status, 1, result.stderr + result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.published, true);
  assert.equal(output.trusted, false);
  assert.equal(output.reason, "review_authority_marker_missing");
});

test("rejects a verdict whose visible body changed after trusted approval", () => {
  const result = run(
    trustedVerdictFixture({
      tamper(body) {
        return body.replace("- **Security:** none", "- **Security:** definitely none");
      },
    }),
  );
  assert.equal(result.status, 1, result.stderr + result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.published, true);
  assert.equal(output.trusted, false);
  assert.match(output.reason, /review_authority_invalid:scope_mismatch/);
});
