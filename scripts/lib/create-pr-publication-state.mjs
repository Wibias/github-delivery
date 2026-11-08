import { createHash } from "node:crypto";

import {
  mutationOperationKey,
  mutationReceiptCompleted,
} from "./mutation-document-execution.mjs";

const CREATE_PR_PUBLICATION_WORKFLOWS = new Set([
  "create-pr-for-issue",
  "create-pr-from-local-work",
]);
const ACTIONS = Object.freeze(["push_code", "create_pr"]);
const ALREADY_PUBLISHED_ACTIONS = Object.freeze(["create_pr"]);
const VERIFICATION_ACTION = "published_head";
const VERIFICATION_KIND = "github-delivery/published-head-verification";
const PUBLICATION_MODES = Object.freeze(["push", "already-published"]);

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameIdentity(left, right) {
  return String(left || "").toLowerCase() === String(right || "").toLowerCase();
}

function lower(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isSha(value) {
  return /^[0-9a-f]{40,64}$/.test(lower(value));
}

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function normalizePublishedHead(value) {
  if (!plainObject(value)) return null;
  const repo = String(value.repo || "").trim();
  const remote = String(value.remote || "").trim();
  const branch = String(value.branch || "").trim();
  const base = String(value.base || "").trim();
  const sha = lower(value.sha);
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo) || !remote || !branch || !base || !isSha(sha)) {
    return null;
  }
  return { repo, remote, branch, base, sha };
}

function headBranchOf(value) {
  const head = String(value?.head || "").trim();
  if (!head) return null;
  const separator = head.indexOf(":");
  const branch = (separator < 0 ? head : head.slice(separator + 1)).trim();
  return branch || null;
}

function samePublishedHead(left, right) {
  const a = normalizePublishedHead(left);
  const b = normalizePublishedHead(right);
  return Boolean(
    a &&
    b &&
    sameIdentity(a.repo, b.repo) &&
    a.remote === b.remote &&
    a.branch === b.branch &&
    a.base === b.base &&
    sameIdentity(a.sha, b.sha),
  );
}

function verificationKeyFor({ publishedHead, operationKeys, headSha }) {
  const scope = normalizePublishedHead(publishedHead);
  const createKey = String(operationKeys?.create_pr || "");
  if (!scope || !createKey) return null;
  return `published-head:${sha256(JSON.stringify([
    "github-delivery/create-pr-exact-head-verification",
    lower(scope.repo),
    scope.remote,
    scope.branch,
    scope.base,
    scope.sha,
    createKey,
    lower(headSha || scope.sha),
  ]))}`;
}

export function normalizePublishedHeadScope(value) {
  return normalizePublishedHead(value);
}

export function normalizePublishedHeadVerification(value) {
  if (!plainObject(value) || value.kind !== VERIFICATION_KIND) return null;
  const scope = normalizePublishedHead(value);
  if (!scope) return null;
  const observedSha = lower(value.observedSha || value.sha);
  const baseSha = lower(value.baseSha);
  const ancestry = lower(value.ancestry);
  if (!isSha(observedSha) || !isSha(baseSha)) return null;
  if (observedSha !== scope.sha) return null;
  if (!["ahead", "identical"].includes(ancestry)) return null;
  return {
    kind: VERIFICATION_KIND,
    ...scope,
    observedSha,
    baseSha,
    ancestry,
  };
}

function normalizeReplannedFrom(value) {
  if (!plainObject(value)) return null;
  const mode = String(value.mode || "");
  const pushOperationKey = String(value.pushOperationKey || "");
  const createPrOperationKey = String(value.createPrOperationKey || "");
  const reason = String(value.reason || "").trim();
  if (mode !== "push" || !pushOperationKey || !createPrOperationKey || !reason) return null;
  return {
    mode,
    headSha: value.headSha ? lower(value.headSha) : null,
    pushOperationKey,
    createPrOperationKey,
    reason,
    replannedAt: Number.isFinite(value.replannedAt) ? value.replannedAt : null,
  };
}

export function createPrPublicationVerificationKey(value) {
  const lock = normalizeCreatePrPublicationPlanLock(value);
  if (!lock || lock.mode !== "already-published") return null;
  return verificationKeyFor(lock);
}

export function normalizeCreatePrPublicationPlanLock(value) {
  if (!plainObject(value)) return null;
  if (value.schemaVersion !== 1 || value.kind !== "github-delivery/create-pr-publication-plan-lock") {
    return null;
  }
  const mode = value.mode === undefined || value.mode === ""
    ? "push"
    : String(value.mode);
  if (!PUBLICATION_MODES.includes(mode)) return null;
  const operationKeys = plainObject(value.operationKeys) ? value.operationKeys : {};
  const createKey = String(operationKeys.create_pr || "");
  if (!createKey) return null;

  if (mode === "push") {
    const pushKey = String(operationKeys.push_code || "");
    if (!pushKey || pushKey === createKey) return null;
    return {
      schemaVersion: 1,
      kind: "github-delivery/create-pr-publication-plan-lock",
      mode,
      headSha: value.headSha ? String(value.headSha) : null,
      operationKeys: {
        push_code: pushKey,
        create_pr: createKey,
      },
      lockedAt: Number.isFinite(value.lockedAt) ? value.lockedAt : null,
    };
  }

  if (operationKeys.push_code) return null;
  const publishedHead = normalizePublishedHead(value.publishedHead);
  if (!publishedHead) return null;
  const headSha = value.headSha ? lower(value.headSha) : publishedHead.sha;
  if (!sameIdentity(headSha, publishedHead.sha)) return null;
  const lock = {
    schemaVersion: 1,
    kind: "github-delivery/create-pr-publication-plan-lock",
    mode,
    headSha,
    publishedHead,
    operationKeys: {
      create_pr: createKey,
    },
    lockedAt: Number.isFinite(value.lockedAt) ? value.lockedAt : null,
  };
  lock.verificationKey = verificationKeyFor(lock);
  const replannedFrom = normalizeReplannedFrom(value.replannedFrom);
  if (replannedFrom) lock.replannedFrom = replannedFrom;
  return lock;
}

export function normalizeCreatePrPublicationReceipts(value) {
  const input = plainObject(value) ? value : {};
  const normalized = {};
  for (const action of [...ACTIONS, VERIFICATION_ACTION]) {
    const receipt = input[action];
    if (!plainObject(receipt) || !mutationReceiptCompleted(receipt)) continue;
    const operationKey = String(receipt.operationKey || "");
    if (!operationKey) continue;
    const entry = {
      action,
      operationKey,
      status: String(receipt.status),
      recordedAt: Number.isFinite(receipt.recordedAt) ? receipt.recordedAt : null,
    };
    if (action === VERIFICATION_ACTION) {
      const verification = normalizePublishedHeadVerification(receipt.verification);
      if (!verification) continue;
      entry.verification = verification;
    }
    normalized[action] = entry;
  }
  return normalized;
}

function planMode(plan) {
  if (plan?.publicationMode === undefined || plan?.publicationMode === "") return "push";
  return String(plan.publicationMode);
}

export function createPrPublicationPlanLock(plan, { headSha = null, now = Date.now } = {}) {
  if (!plainObject(plan) || !Array.isArray(plan.requests)) {
    throw new Error("create_pr_publication_plan_invalid");
  }
  const mode = planMode(plan);
  if (!PUBLICATION_MODES.includes(mode)) {
    throw new Error("create_pr_publication_plan_invalid");
  }

  if (mode === "already-published") {
    if (plan.requests.length !== 1) throw new Error("create_pr_publication_plan_invalid");
    const createRequest = plan.requests[0];
    if (String(createRequest?.action || "") !== "create_pr") {
      throw new Error("create_pr_publication_plan_invalid");
    }
    if (createRequest?.draft !== true) {
      throw new Error("create_pr_publication_plan_draft_only");
    }
    const publishedHead = normalizePublishedHead(createRequest.publishedHead);
    if (!publishedHead) throw new Error("create_pr_publication_plan_invalid");
    if (!sameIdentity(publishedHead.repo, createRequest.repo)) {
      throw new Error("create_pr_publication_plan_repo_mismatch");
    }
    if (publishedHead.base !== String(createRequest.base || "")) {
      throw new Error("create_pr_publication_plan_base_mismatch");
    }
    if (publishedHead.branch !== headBranchOf(createRequest)) {
      throw new Error("create_pr_publication_plan_branch_mismatch");
    }
    if (headSha && !sameIdentity(publishedHead.sha, headSha)) {
      throw new Error("create_pr_publication_plan_head_mismatch");
    }
    const lock = normalizeCreatePrPublicationPlanLock({
      schemaVersion: 1,
      kind: "github-delivery/create-pr-publication-plan-lock",
      mode,
      headSha: publishedHead.sha,
      publishedHead,
      operationKeys: {
        create_pr: mutationOperationKey(createRequest),
      },
      lockedAt: now(),
    });
    if (!lock) throw new Error("create_pr_publication_plan_invalid");
    return lock;
  }

  if (plan.requests.length !== ACTIONS.length) {
    throw new Error("create_pr_publication_plan_invalid");
  }
  const byAction = new Map(plan.requests.map((request) => [String(request?.action || ""), request]));
  if (byAction.size !== ACTIONS.length || ACTIONS.some((action) => !byAction.has(action))) {
    throw new Error("create_pr_publication_plan_invalid");
  }
  const createRequest = byAction.get("create_pr");
  if (createRequest?.draft !== true) {
    throw new Error("create_pr_publication_plan_draft_only");
  }
  if (headSha && !sameIdentity(byAction.get("push_code")?.newTip, headSha)) {
    throw new Error("create_pr_publication_plan_head_mismatch");
  }
  return {
    schemaVersion: 1,
    kind: "github-delivery/create-pr-publication-plan-lock",
    mode,
    headSha: headSha ? String(headSha) : String(byAction.get("push_code")?.newTip || "") || null,
    operationKeys: Object.fromEntries(
      ACTIONS.map((action) => [action, mutationOperationKey(byAction.get(action))]),
    ),
    lockedAt: now(),
  };
}

export function assertCreatePrPublicationRequest(snapshot, request) {
  if (!CREATE_PR_PUBLICATION_WORKFLOWS.has(String(snapshot?.workflow || ""))) return null;
  const action = String(request?.action || "");
  const lock = normalizeCreatePrPublicationPlanLock(snapshot?.publicationPlan);
  if (!lock) throw new Error("create_pr_publication_plan_missing");
  if (snapshot?.headSha && lock.headSha && !sameIdentity(lock.headSha, snapshot.headSha)) {
    throw new Error("create_pr_publication_plan_stale");
  }
  const allowed = lock.mode === "already-published" ? ALREADY_PUBLISHED_ACTIONS : ACTIONS;
  if (!allowed.includes(action)) {
    throw new Error("create_pr_publication_plan_mismatch");
  }
  if (lock.mode === "already-published") {
    if (!sameIdentity(request?.repo, lock.publishedHead.repo)) {
      throw new Error("create_pr_publication_plan_mismatch");
    }
    if (String(request?.base || "") !== lock.publishedHead.base) {
      throw new Error("create_pr_publication_plan_mismatch");
    }
    if (headBranchOf(request) !== lock.publishedHead.branch) {
      throw new Error("create_pr_publication_plan_mismatch");
    }
    if (!samePublishedHead(request?.publishedHead, lock.publishedHead)) {
      throw new Error("create_pr_publication_plan_mismatch");
    }
  }
  const operationKey = mutationOperationKey(request);
  if (lock.operationKeys[action] !== operationKey) {
    throw new Error("create_pr_publication_plan_mismatch");
  }
  return { action, operationKey };
}

function verificationMatchesLock(verification, lock) {
  const normalized = normalizePublishedHeadVerification(verification);
  return Boolean(
    normalized &&
    lock?.mode === "already-published" &&
    samePublishedHead(normalized, lock.publishedHead),
  );
}

export function reconcileCreatePrPublicationReceipts(snapshot, output, { now = Date.now } = {}) {
  if (!CREATE_PR_PUBLICATION_WORKFLOWS.has(String(snapshot?.workflow || ""))) {
    return { changed: false, receipts: normalizeCreatePrPublicationReceipts(snapshot?.publicationReceipts) };
  }
  const lock = normalizeCreatePrPublicationPlanLock(snapshot?.publicationPlan);
  if (!lock) {
    return { changed: false, receipts: normalizeCreatePrPublicationReceipts(snapshot?.publicationReceipts) };
  }
  const receipts = normalizeCreatePrPublicationReceipts(snapshot?.publicationReceipts);
  const results = Array.isArray(output?.results) ? output.results : [output];
  let changed = false;
  for (const result of results) {
    const action = String(result?.action || "");
    if (!mutationReceiptCompleted(result)) continue;
    const operationKey = String(result?.operationKey || "");
    if (!operationKey) continue;
    if (!["push_code", "create_pr"].includes(action)) continue;
    if (lock.mode === "already-published" && action === "push_code") continue;
    if (operationKey !== lock.operationKeys[action]) continue;
    const status = String(result.status);
    const previous = receipts[action];
    if (previous?.operationKey !== operationKey || previous?.status !== status) {
      receipts[action] = {
        action,
        operationKey,
        status,
        recordedAt: now(),
      };
      changed = true;
    }
    if (lock.mode !== "already-published" || action !== "create_pr") continue;

    const verification = normalizePublishedHeadVerification(
      result?.publishedHeadVerification ?? result?.preflight?.publishedHead,
    );
    if (!verification || !verificationMatchesLock(verification, lock)) continue;
    const verificationKey = createPrPublicationVerificationKey(lock);
    if (!verificationKey) continue;
    const current = receipts[VERIFICATION_ACTION];
    if (
      current?.operationKey === verificationKey &&
      current?.verification &&
      samePublishedHead(current.verification, verification) &&
      current.verification.baseSha === verification.baseSha &&
      current.verification.ancestry === verification.ancestry
    ) {
      continue;
    }
    receipts[VERIFICATION_ACTION] = {
      action: VERIFICATION_ACTION,
      operationKey: verificationKey,
      status: "succeeded",
      recordedAt: now(),
      verification,
    };
    changed = true;
  }
  return { changed, receipts };
}

export function assertCreatePrPublicationComplete(snapshot) {
  if (!CREATE_PR_PUBLICATION_WORKFLOWS.has(String(snapshot?.workflow || ""))) return null;
  const lock = normalizeCreatePrPublicationPlanLock(snapshot?.publicationPlan);
  if (!lock) throw new Error("create_pr_publication_plan_missing");
  const receipts = normalizeCreatePrPublicationReceipts(snapshot?.publicationReceipts);
  const actions = lock.mode === "already-published" ? ALREADY_PUBLISHED_ACTIONS : ACTIONS;
  for (const action of actions) {
    if (receipts[action]?.operationKey !== lock.operationKeys[action]) {
      throw new Error("create_pr_publication_incomplete");
    }
  }
  if (lock.mode === "already-published") {
    const verificationKey = createPrPublicationVerificationKey(lock);
    const receipt = receipts[VERIFICATION_ACTION];
    if (
      !verificationKey ||
      receipt?.operationKey !== verificationKey ||
      !verificationMatchesLock(receipt?.verification, lock)
    ) {
      throw new Error("create_pr_publication_incomplete");
    }
  }
  return { lock: structuredClone(lock), receipts: structuredClone(receipts) };
}
