const WORK_ITEM_KEY_RE = /^[A-Z][A-Z0-9]*-\d+$/;
const REVIEW_NAME_RE = /\b(?:in review|review|ready for review|code review|peer review)\b/i;
const ACTIVE_NAME_RE = /\b(?:in progress|started|active|doing|implementation)\b/i;
const DONE_NAME_RE = /\b(?:done|complete|completed|shipped|released)\b/i;
const BACKLOG_NAME_RE = /\b(?:backlog|todo|to do|ready|unstarted)\b/i;

function requiredText(value, name) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${name}_required`);
  return text;
}

export function normalizeWorkItemKey(value) {
  const key = requiredText(value, "work_item_key").toUpperCase();
  if (!WORK_ITEM_KEY_RE.test(key)) throw new Error("work_item_key_invalid");
  return key;
}

export function normalizeTrackerStatus(status = {}) {
  const id = requiredText(status.id, "status_id");
  const name = requiredText(status.name, "status_name");
  const type = String(status.type ?? "").trim().toLowerCase() || null;
  return { id, name, type };
}

function uniqueStatuses(statuses) {
  const byId = new Map();
  for (const raw of statuses || []) {
    const status = normalizeTrackerStatus(raw);
    const prior = byId.get(status.id);
    if (prior && (prior.name !== status.name || prior.type !== status.type)) {
      throw new Error(`status_identity_conflict:${status.id}`);
    }
    byId.set(status.id, status);
  }
  return [...byId.values()];
}

function targetCandidates(statuses, milestone) {
  if (milestone === "review") {
    return statuses.filter((status) => status.type === "started" && REVIEW_NAME_RE.test(status.name));
  }
  if (milestone === "done") {
    const typed = statuses.filter((status) => status.type === "completed");
    const exact = typed.filter((status) => DONE_NAME_RE.test(status.name));
    return exact.length ? exact : typed;
  }
  if (milestone === "active") {
    const typed = statuses.filter((status) => status.type === "started" && !REVIEW_NAME_RE.test(status.name));
    const exact = typed.filter((status) => ACTIVE_NAME_RE.test(status.name));
    return exact.length ? exact : typed;
  }
  if (milestone === "backlog") {
    const typed = statuses.filter((status) => ["backlog", "unstarted"].includes(status.type));
    const exact = typed.filter((status) => BACKLOG_NAME_RE.test(status.name));
    return exact.length ? exact : typed;
  }
  throw new Error(`work_item_milestone_invalid:${milestone}`);
}

export function selectTrackerStatus(statuses, milestone) {
  const candidates = targetCandidates(uniqueStatuses(statuses), milestone);
  if (candidates.length === 0) {
    return { state: "unknown", milestone, reason: `${milestone}_status_not_configured`, candidates: [] };
  }
  if (candidates.length > 1) {
    return { state: "ambiguous", milestone, reason: `${milestone}_status_ambiguous`, candidates };
  }
  return { state: "resolved", milestone, status: candidates[0], candidates };
}

export function deriveWorkItemMilestone(evidence = {}) {
  if (evidence.merged === true) return { state: "resolved", milestone: "done", source: "merged_pr" };
  if (evidence.openPullRequest === true) return { state: "resolved", milestone: "review", source: "open_pr" };
  if (evidence.implementationStarted === true || evidence.publishedBranch === true) {
    return { state: "resolved", milestone: "active", source: evidence.publishedBranch === true ? "published_branch" : "implementation" };
  }
  if (evidence.known === true) return { state: "resolved", milestone: "backlog", source: "known_work_item" };
  return { state: "unknown", milestone: null, source: null, reason: "github_delivery_evidence_incomplete" };
}

export function planTrackerReconciliation({ workItem, statuses = [], evidence = {} } = {}) {
  const key = normalizeWorkItemKey(workItem?.key);
  const currentStatusId = requiredText(workItem?.statusId, "work_item_status_id");
  const milestone = deriveWorkItemMilestone(evidence);
  if (milestone.state !== "resolved") {
    return { state: "unknown", key, mutation: null, milestone, reason: milestone.reason };
  }
  const target = selectTrackerStatus(statuses, milestone.milestone);
  if (target.state !== "resolved") {
    return { state: target.state, key, mutation: null, milestone, target, reason: target.reason };
  }
  if (target.status.id === currentStatusId) {
    return { state: "noop", key, mutation: null, milestone, target, reason: "already_reconciled" };
  }
  return {
    state: "transition",
    key,
    milestone,
    target,
    mutation: {
      kind: "tracker-status-transition",
      workItemKey: key,
      expectedStatusId: currentStatusId,
      targetStatusId: target.status.id,
    },
    reason: null,
  };
}

export function planWorkItemDelivery({ workItem, coveringPullRequest = null, evidence = {} } = {}) {
  const key = normalizeWorkItemKey(workItem?.key);
  if (evidence.merged === true) return { key, phase: "reconcile", coveringPullRequest, reason: "merged" };
  if (coveringPullRequest?.state === "open") return { key, phase: "resume_pr", coveringPullRequest, reason: "covering_pr" };
  if (evidence.implementationStarted === true) return { key, phase: "publish", coveringPullRequest: null, reason: "implementation_present" };
  return { key, phase: "research", coveringPullRequest: null, reason: "no_covering_pr" };
}
