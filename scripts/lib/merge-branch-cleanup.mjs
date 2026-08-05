export const DEFAULT_PROTECTED_BRANCHES = new Set([
  "main",
  "master",
  "dev",
  "develop",
  "trunk",
  "release",
  "production",
]);

function normalizeLogin(login) {
  return typeof login === "string" ? login.trim().toLowerCase() : "";
}

function normalizeBranch(branch) {
  return typeof branch === "string" ? branch.trim() : "";
}

function isMerged(input) {
  if (input.merged === true || input.isMerged === true) {
    return true;
  }
  if (input.mergedAt) {
    return true;
  }
  const state = String(input.state || input.prState || "").toUpperCase();
  return state === "MERGED";
}

function resolveRepository(input) {
  return (
    input.targetRepository?.trim() ||
    input.targetRepo?.trim() ||
    input.headRepository?.trim() ||
    input.headRepo?.trim() ||
    input.baseRepository?.trim() ||
    input.baseRepo?.trim() ||
    null
  );
}

function withStatus(decision) {
  if (decision.action === "delete" && decision.targetRepository) {
    return {
      ...decision,
      status: `branch deleted: ${decision.targetRepository}@${decision.branch}`,
    };
  }
  if (decision.reason?.startsWith("branch kept: head owned by @")) {
    return {
      ...decision,
      status: decision.reason,
    };
  }
  return decision;
}

/**
 * Decide whether a merged PR head branch should be deleted for the authenticated actor.
 */
export function evaluateHeadBranchCleanup(input) {
  const headRefName = normalizeBranch(input.headRefName);
  const headOwnerLogin = normalizeLogin(input.headOwnerLogin);
  const actorLogin = normalizeLogin(input.actorLogin);
  const protectedBranches = input.protectedBranches ?? DEFAULT_PROTECTED_BRANCHES;

  if (!isMerged(input)) {
    return withStatus({
      action: "skip",
      reason: "branch kept: pr not merged",
      targetRepository: null,
      targetRepo: null,
      branch: headRefName || null,
    });
  }

  if (input.keepBranch) {
    return {
      action: "skip",
      reason: "branch kept: user requested keep",
      targetRepository: null,
      targetRepo: null,
      branch: headRefName || null,
    };
  }

  if (!headRefName) {
    return {
      action: "skip",
      reason: "branch kept: missing head ref",
      targetRepository: null,
      targetRepo: null,
      branch: null,
    };
  }

  if (!headOwnerLogin || !actorLogin) {
    return {
      action: "skip",
      reason: "branch kept: missing actor or head owner",
      targetRepository: null,
      targetRepo: null,
      branch: headRefName,
    };
  }

  if (headOwnerLogin !== actorLogin) {
    return withStatus({
      action: "skip",
      reason: `branch kept: head owned by @${input.headOwnerLogin}`,
      targetRepository: null,
      targetRepo: null,
      branch: headRefName,
    });
  }

  if (protectedBranches.has(headRefName)) {
    return {
      action: "skip",
      reason: "branch kept: protected shared branch",
      targetRepository: null,
      targetRepo: null,
      branch: headRefName,
    };
  }

  const targetRepository = resolveRepository(input);

  if (!targetRepository) {
    return {
      action: "skip",
      reason: "branch kept: missing target repository",
      targetRepository: null,
      targetRepo: null,
      branch: headRefName,
    };
  }

  return withStatus({
    action: "delete",
    reason: "branch deleted: head owned by authenticated actor",
    targetRepository,
    targetRepo: targetRepository,
    branch: headRefName,
  });
}
