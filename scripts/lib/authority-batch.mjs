export function attachAuthorityGrants(operations, authorization) {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error("authority_batch_operations_required");
  }
  if (!authorization || !Array.isArray(authorization.grants)) {
    throw new Error("authority_grants_invalid");
  }
  if (authorization.grants.length !== operations.length) {
    throw new Error("authority_grant_count_mismatch");
  }

  const byOperation = new Map();
  for (const grant of authorization.grants) {
    const index = Number(grant?.operation);
    if (!Number.isInteger(index) || index < 0 || index >= operations.length) {
      throw new Error("authority_grant_operation_invalid");
    }
    if (byOperation.has(index)) throw new Error("authority_grant_operation_duplicate");
    if (typeof grant.token !== "string" || !grant.token.startsWith("gd1.")) {
      throw new Error("authority_grant_token_invalid");
    }
    byOperation.set(index, grant);
  }

  return {
    batchId: authorization.batchId ?? null,
    expiresAt: authorization.expiresAt ?? null,
    requests: operations.map((operation, index) => ({
      ...structuredClone(operation),
      authorityGrant: byOperation.get(index).token,
    })),
  };
}
