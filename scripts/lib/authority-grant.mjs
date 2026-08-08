import { createHash, createPublicKey, verify } from "node:crypto";

import { MUTATION_MODES, normalizeMutationMode } from "./mutation-policy.mjs";

const TOKEN_PREFIX = "gd1";
const AUDIENCE = "github-delivery";
const DEFAULT_MAX_TTL_SECONDS = 600;
const DEFAULT_CLOCK_SKEW_SECONDS = 30;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
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

function modeRank(value) {
  const mode = normalizeMutationMode(value);
  return MUTATION_MODES.indexOf(mode);
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
  if (
    payload.exactTextSha256 !== undefined &&
    !/^[0-9a-f]{64}$/i.test(String(payload.exactTextSha256))
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

function sanitizedClaims(payload) {
  return {
    version: payload.version,
    aud: payload.aud,
    repo: payload.repo,
    action: payload.action,
    resource: structuredClone(payload.resource),
    maxMutationMode: normalizeMutationMode(payload.maxMutationMode),
    explicitInstruction: payload.explicitInstruction,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    nonce: payload.nonce,
    ...(payload.exactTextSha256 ? { exactTextSha256: payload.exactTextSha256 } : {}),
  };
}

export function verifyAuthorityGrant({
  token,
  publicKey,
  request = {},
  now,
  maxTtlSeconds = DEFAULT_MAX_TTL_SECONDS,
  clockSkewSeconds = DEFAULT_CLOCK_SKEW_SECONDS,
} = {}) {
  if (!token) {
    return { provenance: "caller_asserted", verified: false, claims: null, reason: "grant_absent" };
  }
  if (!publicKey) {
    return { provenance: "caller_asserted", verified: false, claims: null, reason: "public_key_missing" };
  }
  if (!Number.isFinite(maxTtlSeconds) || maxTtlSeconds <= 0) {
    throw new Error("authority_max_ttl_invalid");
  }
  if (!Number.isFinite(clockSkewSeconds) || clockSkewSeconds < 0) {
    throw new Error("authority_clock_skew_invalid");
  }

  const parsed = parseToken(token);
  if (!parsed.ok) {
    return { provenance: "caller_asserted", verified: false, claims: null, reason: parsed.reason };
  }

  let key;
  try {
    key = createPublicKey(publicKey);
  } catch {
    return { provenance: "caller_asserted", verified: false, claims: null, reason: "public_key_invalid" };
  }

  let signatureValid = false;
  try {
    signatureValid = verify(null, parsed.signedBytes, key, parsed.signature);
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    return { provenance: "caller_asserted", verified: false, claims: null, reason: "bad_signature" };
  }

  const payload = parsed.payload;
  const claimError = validateClaims(payload);
  if (claimError) {
    return { provenance: "caller_asserted", verified: false, claims: null, reason: claimError };
  }
  if (payload.aud !== AUDIENCE) {
    return { provenance: "caller_asserted", verified: false, claims: null, reason: "wrong_audience" };
  }
  if (payload.repo !== request.repo) {
    return { provenance: "caller_asserted", verified: false, claims: null, reason: "repo_mismatch" };
  }
  if (payload.action !== request.action) {
    return { provenance: "caller_asserted", verified: false, claims: null, reason: "action_mismatch" };
  }
  if (!verifyResourceBinding(payload, request)) {
    return { provenance: "caller_asserted", verified: false, claims: null, reason: "resource_mismatch" };
  }

  const current = normalizeNow(now);
  if (payload.issuedAt > current + clockSkewSeconds) {
    return { provenance: "caller_asserted", verified: false, claims: null, reason: "not_yet_valid" };
  }
  if (payload.expiresAt < current - clockSkewSeconds) {
    return { provenance: "caller_asserted", verified: false, claims: null, reason: "expired" };
  }
  if (payload.expiresAt <= payload.issuedAt) {
    return { provenance: "caller_asserted", verified: false, claims: null, reason: "time_invalid" };
  }
  if (payload.expiresAt - payload.issuedAt > maxTtlSeconds) {
    return { provenance: "caller_asserted", verified: false, claims: null, reason: "ttl_exceeded" };
  }

  let requestedMode;
  try {
    requestedMode = normalizeMutationMode(request.mutationMode);
  } catch {
    return { provenance: "caller_asserted", verified: false, claims: null, reason: "mutation_mode_invalid" };
  }
  if (modeRank(requestedMode) > modeRank(payload.maxMutationMode)) {
    return {
      provenance: "caller_asserted",
      verified: false,
      claims: null,
      reason: "mutation_mode_exceeds_grant",
    };
  }

  let exactTextConfirmed = false;
  if (request.action === "reply_human_thread") {
    const actualHash = sha256(request.body);
    if (
      !payload.exactTextSha256 ||
      payload.exactTextSha256 !== actualHash ||
      request.exactTextSha256 !== actualHash
    ) {
      return {
        provenance: "caller_asserted",
        verified: false,
        claims: null,
        reason: "exact_text_hash_mismatch",
      };
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
  requireTrusted = false,
  now,
  maxTtlSeconds,
  clockSkewSeconds,
} = {}) {
  const result = verifyAuthorityGrant({
    token,
    publicKey,
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
