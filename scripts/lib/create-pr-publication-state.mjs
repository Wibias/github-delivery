import {
  mutationOperationKey,
  mutationReceiptCompleted,
} from "./mutation-document-execution.mjs";

const LOCAL_WORKFLOW = "create-pr-from-local-work";
const ACTIONS = Object.freeze(["push_code", "create_pr"]);

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameIdentity(left, right) {
  return String(left || "").toLowerCase() === String(right || "").toLowerCase();
}

export function normalizeCreatePrPublicationPlanLock(value) {
  if (!plainObject(value)) return null;
  if (value.schemaVersion !== 1 || value.kind !== "github-delivery/create-pr-publication-plan-lock") {
    return null;
  }
  const operationKeys = plainObject(value.operationKeys) ? value.operationKeys : {};
  const pushKey = String(operationKeys.push_code || "");
  const createKey = String(operationKeys.create_pr || "");
  if (!pushKey || !createKey || pushKey === createKey) return null;
  return {
    schemaVersion: 1,
    kind: "github-delivery/create-pr-publication-plan-lock",
    headSha: value.headSha ? String(value.headSha) : null,
    operationKeys: {
      push_code: pushKey,
      create_pr: createKey,
    },
    lockedAt: Number.isFinite(value.lockedAt) ? value.lockedAt : null,
  };
}

export function normalizeCreatePrPublicationReceipts(value) {
  const input = plainObject(value) ? value : {};
  const normalized = {};
  for (const action of ACTIONS) {
    const receipt = input[action];
    if (!plainObject(receipt) || !mutationReceiptCompleted(receipt)) continue;
    const operationKey = String(receipt.operationKey || "");
    if (!operationKey) continue;
    normalized[action] = {
      action,
      operationKey,
      status: String(receipt.status),
      recordedAt: Number.isFinite(receipt.recordedAt) ? receipt.recordedAt : null,
    };
  }
  return normalized;
}

export function createPrPublicationPlanLock(plan, { headSha = null, now = Date.now } = {}) {
  if (!plainObject(plan) || !Array.isArray(plan.requests)) {
    throw new Error("create_pr_publication_plan_invalid");
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
    headSha: headSha ? String(headSha) : String(byAction.get("push_code")?.newTip || "") || null,
    operationKeys: Object.fromEntries(
      ACTIONS.map((action) => [action, mutationOperationKey(byAction.get(action))]),
    ),
    lockedAt: now(),
  };
}

export function assertCreatePrPublicationRequest(snapshot, request) {
  if (String(snapshot?.workflow || "") !== LOCAL_WORKFLOW) return null;
  const action = String(request?.action || "");
  if (!ACTIONS.includes(action)) return null;
  const lock = normalizeCreatePrPublicationPlanLock(snapshot?.publicationPlan);
  if (!lock) throw new Error("create_pr_publication_plan_missing");
  if (snapshot?.headSha && lock.headSha && !sameIdentity(lock.headSha, snapshot.headSha)) {
    throw new Error("create_pr_publication_plan_stale");
  }
  const operationKey = mutationOperationKey(request);
  if (lock.operationKeys[action] !== operationKey) {
    throw new Error("create_pr_publication_plan_mismatch");
  }
  return { action, operationKey };
}

export function reconcileCreatePrPublicationReceipts(snapshot, output, { now = Date.now } = {}) {
  if (String(snapshot?.workflow || "") !== LOCAL_WORKFLOW) {
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
    if (!ACTIONS.includes(action) || !mutationReceiptCompleted(result)) continue;
    const operationKey = String(result?.operationKey || "");
    if (!operationKey || operationKey !== lock.operationKeys[action]) continue;
    const previous = receipts[action];
    if (previous?.operationKey === operationKey && previous?.status === result.status) continue;
    receipts[action] = {
      action,
      operationKey,
      status: String(result.status),
      recordedAt: now(),
    };
    changed = true;
  }
  return { changed, receipts };
}

export function assertCreatePrPublicationComplete(snapshot) {
  if (String(snapshot?.workflow || "") !== LOCAL_WORKFLOW) return null;
  const lock = normalizeCreatePrPublicationPlanLock(snapshot?.publicationPlan);
  if (!lock) throw new Error("create_pr_publication_plan_missing");
  const receipts = normalizeCreatePrPublicationReceipts(snapshot?.publicationReceipts);
  for (const action of ACTIONS) {
    if (receipts[action]?.operationKey !== lock.operationKeys[action]) {
      throw new Error("create_pr_publication_incomplete");
    }
  }
  return { lock: structuredClone(lock), receipts: structuredClone(receipts) };
}
