import { createHash, createPublicKey, verify } from "node:crypto";

import { authorityScopeSha256 } from "./authority-scope.mjs";

const TOKEN_PREFIX = "gd1";
const AUDIENCE = "github-delivery";
const DEFAULT_MAX_TTL_SECONDS = 600;
const DEFAULT_CLOCK_SKEW_SECONDS = 30;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const SHA256_RE = /^[0-9a-f]{64}$/i;
const MUTATION_MODES = ["read-only", "review", "maintainer", "autonomous"];
const SUPPORTED_ALGORITHMS = new Set(["EdDSA", "ES256"]);
const NUMERIC_RESOURCE_FIELDS = new Set(["pr", "issue", "commentId", "supersedingPr"]);
const RESOURCE_FIELDS = [
  "pr",
  "issue",
  "commentId",
  "threadId",
  "expectedHead",
  "headRefName",
  "targetRepo",
  "supersedingPr",
];

function sha256(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteInteger(value) {
  return Number.isInteger(value) && Number.isFinite(value);
}

function normalizeNow(value) {
  if (value === undefined || value === null) return Math.floor(Date.now() / 1000);
  if (!Number.isFinite(value)) throw new Error("authority_now_invalid");
  return Math.floor(value);
}

function normalizeMutationMode(value = "read-only") {
  const mode = String(value || "read-only").toLowerCase();
  if (!MUTATION_MODES.includes(mode)) {
    throw new Error("mutation_mode_invalid");
  }
  return mode;
}

function modeRank(value) {
  return MUTATION_MODES.indexOf(normalizeMutationMode(value));
}

function resourceValue(field, value) {
  if (NUMERIC_RESOURCE_FIELDS.has(field)) {
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }
  return value === undefined || value === null ? value : String(value);
}

function parseToken(token) {
  if (typeof token !== "string" || !token) return { ok: false, reason: "token_missing" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) {
    return { ok: false, reason: "token_format_invalid" };
  }
  const [, payloadSegment, signatureSegment] = parts;
  if (!BASE64URL_RE.test(payloadSegment) || !BASE64URL_RE.test(signatureSegment)) {
    return { ok: false, reason: "token_encoding_invalid" };
  }

  let payload;
  try {
    const decoded = Buffer.from(payloadSegment, "base64url").toString("utf8");
    payload = JSON.parse(decoded);
  } catch {
    return { ok: false, reason: "payload_invalid" };
  }
  if (!plainObject(payload)) return { ok: false, reason: "payload_invalid" };

  let signature;
  try {
    signature = Buffer.from(signatureSegment, "base64url");
  } catch {
    return { ok: false, reason: "signature_invalid" };
  }
  if (!signature.length) return { ok: false, reason: "signature_invalid" };

  return {
    ok: true,
    payload,
    signature,
    signedBytes: Buffer.from(`${TOKEN_PREFIX}.${payloadSegment}`, "ascii"),
  };
}

function validateClaims(payload) {
  if (payload.version !== 1) return "version_invalid";
  if (payload.alg !== undefined && (typeof payload.alg !== "string" || !payload.alg)) {
    return "algorithm_invalid";
  }
  if (payload.kid !== undefined && (typeof payload.kid !== "string" || !payload.kid)) {
    return "key_id_invalid";
  }
  if (typeof payload.aud !== "string" || !payload.aud) return "audience_missing";
  if (typeof payload.repo !== "string" || !payload.repo.includes("/")) return "repo_invalid";
  if (typeof payload.action !== "string" || !payload.action) return "action_invalid";
  if (!plainObject(payload.resource)) return "resource_invalid";
  if (!MUTATION_MODES.includes(String(payload.maxMutationMode || "").toLowerCase())) {
    return "mutation_mode_invalid";
  }
  if (typeof payload.explicitInstruction !== "boolean") return "explicit_instruction_invalid";
  if (!finiteInteger(payload.issuedAt) || !finiteInteger(payload.expiresAt)) return "time_invalid";
  if (typeof payload.nonce !== "string" || !payload.nonce) return "nonce_invalid";
  if (payload.scopeSha256 !== undefined && !SHA256_RE.test(String(payload.scopeSha256))) {
    return "scope_hash_invalid";
  }
  if (payload.batchId !== undefined && (typeof payload.batchId !== "string" || !payload.batchId)) {
    return "batch_id_invalid";
  }
  if (payload.batchIndex !== undefined && (!finiteInteger(payload.batchIndex) || payload.batchIndex < 0)) {
    return "batch_index_invalid";
  }
  if (payload.batchSha256 !== undefined && !SHA256_RE.test(String(payload.batchSha256))) {
    return "batch_hash_invalid";
  }
  if (payload.redemption !== undefined && payload.redemption !== "required") {
    return "redemption_invalid";
  }
  if (
    payload.exactTextSha256 !== undefined &&
    !SHA256_RE.test(String(payload.exactTextSha256))
  ) {
    return "exact_text_hash_invalid";
  }
  return null;
}

function verifyResourceBinding(payload, request) {
  for (const field of RESOURCE_FIELDS) {
    if (request[field] === undefined || request[field] === null) continue;
    if (!(field in payload.resource)) return false;
    if (resourceValue(field, payload.resource[field]) !== resourceValue(field, request[field])) {
      return false;
    }
  }
  return true;
}

function normalizeAlgorithm(payload) {
  if (payload.alg === undefined) return "EdDSA";
  return String(payload.alg);
}

function validateTrustStore(trustStore) {
  if (!plainObject(trustStore) || trustStore.schemaVersion !== 1 || !Array.isArray(trustStore.keys)) {
    return false;
  }
  return trustStore.keys.every((entry) => plainObject(entry));
}

function selectTrustStoreKey({ payload, trustStore, now }) {
  if (!validateTrustStore(trustStore)) {
    return { ok: false, reason: "trust_store_invalid" };
  }
  if (typeof payload.kid !== "string" || !payload.kid) {
    return { ok: false, reason: "key_id_missing" };
  }
  const entry = trustStore.keys.find((candidate) => candidate.kid === payload.kid);
  if (!entry) return { ok: false, reason: "key_not_found" };

  const algorithm = normalizeAlgorithm(payload);
  if (entry.alg !== algorithm) return { ok: false, reason: "key_algorithm_mismatch" };
  if (!entry.publicKey || typeof entry.publicKey !== "string") {
    return { ok: false, reason: "public_key_missing" };
  }
  if (entry.status === "retired") return { ok: false, reason: "key_retired" };
  if (!new Set(["active", "retiring"]).has(entry.status || "active")) {
    return { ok: false, reason: "key_status_invalid" };
  }
  if (entry.notBefore !== undefined && (!finiteInteger(entry.notBefore) || now < entry.notBefore)) {
    return { ok: false, reason: "key_not_yet_valid" };
  }
  if (entry.notAfter !== undefined && (!finiteInteger(entry.notAfter) || now > entry.notAfter)) {
    return { ok: false, reason: "key_expired" };
  }
  if (entry.repos !== undefined) {
    if (!Array.isArray(entry.repos) || !entry.repos.every((repo) => typeof repo === "string")) {
      return { ok: false, reason: "key_repo_scope_invalid" };
    }
    if (!entry.repos.includes(payload.repo)) {
      return { ok: false, reason: "key_repo_denied" };
    }
  }
  return { ok: true, entry };
}

function verificationKey({ payload, publicKey, trustStore, now }) {
  const algorithm = normalizeAlgorithm(payload);
  if (!SUPPORTED_ALGORITHMS.has(algorithm)) {
    return { ok: false, reason: "algorithm_unsupported" };
  }

  if (payload.alg === undefined) {
    if (!publicKey) return { ok: false, reason: "public_key_missing" };
    return { ok: true, algorithm, keyMaterial: publicKey, entry: null };
  }

  if (!payload.kid && algorithm === "EdDSA" && publicKey) {
    return { ok: true, algorithm, keyMaterial: publicKey, entry: null };
  }

  if (!trustStore) return { ok: false, reason: "trust_store_missing" };
  const selected = selectTrustStoreKey({ payload, trustStore, now });
  if (!selected.ok) return selected;
  return {
    ok: true,
    algorithm,
    keyMaterial: selected.entry.publicKey,
    entry: selected.entry,
  };
}

function verifySignature({ algorithm, key, signedBytes, signature }) {
  try {
    if (algorithm === "EdDSA") {
      return verify(null, signedBytes, key, signature);
    }
    if (algorithm === "ES256") {
      return verify(
        "sha256",
        signedBytes,
        { key, dsaEncoding: "der" },
        signature,
      );
    }
  } catch {
    return false;
  }
  return false;
}

function sanitizedClaims(payload) {
  return {
    version: payload.version,
    ...(payload.alg ? { alg: payload.alg } : {}),
    ...(payload.kid ? { kid: payload.kid } : {}),
    aud: payload.aud,
    repo: payload.repo,
    action: payload.action,
    resource: structuredClone(payload.resource),
    ...(payload.scopeSha256 ? { scopeSha256: payload.scopeSha256 } : {}),
    ...(payload.batchId ? { batchId: payload.batchId } : {}),
    ...(payload.batchIndex !== undefined ? { batchIndex: payload.batchIndex } : {}),
    ...(payload.batchSha256 ? { batchSha256: payload.batchSha256 } : {}),
    maxMutationMode: normalizeMutationMode(payload.maxMutationMode),
    explicitInstruction: payload.explicitInstruction,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    nonce: payload.nonce,
    ...(payload.redemption ? { redemption: payload.redemption } : {}),
    ...(payload.approvalMethod ? { approvalMethod: String(payload.approvalMethod) } : {}),
    ...(payload.exactTextSha256 ? { exactTextSha256: payload.exactTextSha256 } : {}),
  };
}

function unverified(reason) {
  return { provenance: "caller_asserted", verified: false, claims: null, reason };
}

export function verifyAuthorityGrant({
  token,
  publicKey,
  trustStore = null,
  request = {},
  now,
  maxTtlSeconds = DEFAULT_MAX_TTL_SECONDS,
  clockSkewSeconds = DEFAULT_CLOCK_SKEW_SECONDS,
} = {}) {
  if (!token) return unverified("grant_absent");
  if (!Number.isFinite(maxTtlSeconds) || maxTtlSeconds <= 0) {
    throw new Error("authority_max_ttl_invalid");
  }
  if (!Number.isFinite(clockSkewSeconds) || clockSkewSeconds < 0) {
    throw new Error("authority_clock_skew_invalid");
  }

  if (trustStore === null && plainObject(publicKey) && publicKey.schemaVersion === 1) {
    trustStore = publicKey;
    publicKey = null;
  }

  const parsed = parseToken(token);
  if (!parsed.ok) return unverified(parsed.reason);

  const current = normalizeNow(now);
  const selected = verificationKey({
    payload: parsed.payload,
    publicKey,
    trustStore,
    now: current,
  });
  if (!selected.ok) return unverified(selected.reason);

  let key;
  try {
    key = createPublicKey(selected.keyMaterial);
  } catch {
    return unverified("public_key_invalid");
  }

  if (!verifySignature({
    algorithm: selected.algorithm,
    key,
    signedBytes: parsed.signedBytes,
    signature: parsed.signature,
  })) {
    return unverified("bad_signature");
  }

  const payload = parsed.payload;
  const claimError = validateClaims(payload);
  if (claimError) return unverified(claimError);
  if (payload.aud !== AUDIENCE) return unverified("wrong_audience");
  if (payload.repo !== request.repo) return unverified("repo_mismatch");
  if (payload.action !== request.action) return unverified("action_mismatch");
  if (!verifyResourceBinding(payload, request)) return unverified("resource_mismatch");

  const requireScopeHash = selected.entry?.requireScopeHash === true;
  if (requireScopeHash && !payload.scopeSha256) return unverified("scope_hash_missing");
  if (payload.scopeSha256) {
    let actualScope;
    try {
      actualScope = authorityScopeSha256(request);
    } catch {
      return unverified("scope_invalid");
    }
    if (payload.scopeSha256 !== actualScope) return unverified("scope_mismatch");
  }

  if (payload.issuedAt > current + clockSkewSeconds) return unverified("not_yet_valid");
  if (payload.expiresAt < current - clockSkewSeconds) return unverified("expired");
  if (payload.expiresAt <= payload.issuedAt) return unverified("time_invalid");
  if (payload.expiresAt - payload.issuedAt > maxTtlSeconds) return unverified("ttl_exceeded");

  let requestedMode;
  try {
    requestedMode = normalizeMutationMode(request.mutationMode);
  } catch {
    return unverified("mutation_mode_invalid");
  }
  if (modeRank(requestedMode) > modeRank(payload.maxMutationMode)) {
    return unverified("mutation_mode_exceeds_grant");
  }

  if (selected.entry?.requireRedemption === true && payload.redemption !== "required") {
    return unverified("redemption_required");
  }

  let exactTextConfirmed = false;
  if (request.action === "reply_human_thread") {
    const actualHash = sha256(request.body);
    if (
      !payload.exactTextSha256 ||
      payload.exactTextSha256 !== actualHash ||
      request.exactTextSha256 !== actualHash
    ) {
      return unverified("exact_text_hash_mismatch");
    }
    exactTextConfirmed = true;
  }

  return {
    provenance: "trusted_grant",
    verified: true,
    claims: sanitizedClaims(payload),
    reason: null,
    effective: {
      mutationMode: requestedMode,
      explicitInstruction: payload.explicitInstruction === true,
      exactTextConfirmed,
    },
  };
}

export function classifyAuthority({
  request = {},
  token = request.authorityGrant,
  publicKey = null,
  trustStore = null,
  requireTrusted = false,
  now,
  maxTtlSeconds,
  clockSkewSeconds,
} = {}) {
  const result = verifyAuthorityGrant({
    token,
    publicKey,
    trustStore,
    request,
    now,
    maxTtlSeconds,
    clockSkewSeconds,
  });

  if (token && !result.verified) {
    throw new Error(`authority_grant_invalid:${result.reason}`);
  }
  if (requireTrusted && !result.verified) {
    throw new Error(`trusted_authority_required:${result.reason}`);
  }
  if (result.verified) return result;

  return {
    ...result,
    effective: {
      mutationMode: request.mutationMode,
      explicitInstruction: request.explicitInstruction === true,
      exactTextConfirmed: request.exactTextConfirmed === true,
    },
  };
}
