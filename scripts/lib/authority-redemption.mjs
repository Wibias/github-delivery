const SHA256_RE = /^[0-9a-f]{64}$/i;

export function redeemAuthorityBeforeMutation({
  authority,
  authorityGrant,
  redeemer = null,
} = {}) {
  if (!authority?.verified || authority?.claims?.redemption !== "required") {
    return null;
  }
  if (typeof authorityGrant !== "string" || !authorityGrant.startsWith("gd1.")) {
    throw new Error("authority_redemption_required:grant_missing");
  }
  if (typeof redeemer !== "function") {
    throw new Error("authority_redemption_required:redeemer_missing");
  }

  const claims = authority.claims;
  if (!SHA256_RE.test(String(claims.scopeSha256 || ""))) {
    throw new Error("authority_redemption_scope_missing");
  }
  if (typeof claims.nonce !== "string" || !claims.nonce) {
    throw new Error("authority_redemption_nonce_missing");
  }

  const result = redeemer({
    token: authorityGrant,
    scopeSha256: claims.scopeSha256,
    nonce: claims.nonce,
    batchId: claims.batchId ?? null,
    batchIndex: claims.batchIndex ?? null,
  });
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("authority_redemption_result_invalid");
  }
  if (result.status !== "consumed") {
    throw new Error("authority_redemption_not_consumed");
  }
  if (result.nonce !== claims.nonce) {
    throw new Error("authority_redemption_nonce_mismatch");
  }
  if (!Number.isInteger(result.consumedAt) || !Number.isFinite(result.consumedAt)) {
    throw new Error("authority_redemption_time_invalid");
  }

  return {
    status: "consumed",
    nonce: result.nonce,
    consumedAt: result.consumedAt,
  };
}
