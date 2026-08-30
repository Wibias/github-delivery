import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { createEvidenceRegistry } from "./watchdog-evidence-registry.mjs";

const DEFAULT_BUDGETS = Object.freeze({
  noProgressWarn: 2,
  noProgressRestrictEvidence: 3,
  noProgressInterrupt: 4,
  maxPhaseRetries: 3,
  maxWorkflowSteps: 80,
  maxEvidenceActions: 30,
  maxWorkflowTokens: 50_000,
  maxPhaseTokens: 12_000,
  maxWallTimeMs: 30 * 60 * 1_000,
});

const MUTATION_OPERATION_KEY_RE = /^(?:payload:[0-9a-f]{64}|idempotency:[0-9a-f]{64}:payload:[0-9a-f]{64})$/i;
const PRE_OPEN_WORKFLOWS = new Set([
  "create-pr-for-issue",
  "create-pr-from-local-work",
]);
const PRE_OPEN_PUBLICATION_ACTIONS = new Set(["push_code", "create_pr"]);

function nonNegativeInteger(value, fallback = 0) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function normalizeBudgets(input = {}) {
  const budgets = { ...DEFAULT_BUDGETS, ...input };
  for (const key of [
    "noProgressWarn",
    "noProgressRestrictEvidence",
    "noProgressInterrupt",
    "maxPhaseRetries",
    "maxWorkflowSteps",
    "maxEvidenceActions",
    "maxWorkflowTokens",
    "maxPhaseTokens",
    "maxWallTimeMs",
  ]) positiveInteger(budgets[key], key);
  if (budgets.noProgressRestrictEvidence < budgets.noProgressWarn) {
    throw new Error("noProgressRestrictEvidence must be >= noProgressWarn");
  }
  if (budgets.noProgressInterrupt < budgets.noProgressRestrictEvidence) {
    throw new Error("noProgressInterrupt must be >= noProgressRestrictEvidence");
  }
  return budgets;
}

function normalizeGraph(graph) {
  if (!graph || typeof graph !== "object" || Array.isArray(graph)) {
    throw new Error("workflow graph is required");
  }
  const normalized = {};
  for (const [phase, targets] of Object.entries(graph)) {
    if (!phase || !Array.isArray(targets)) throw new Error("workflow graph entries must be phase arrays");
    normalized[phase] = [...new Set(targets.map(String))];
  }
  for (const targets of Object.values(normalized)) {
    for (const target of targets) {
      if (!Object.hasOwn(normalized, target)) {
        throw new Error(`workflow graph target ${target} has no declared phase`);
      }
    }
  }
  return normalized;
}

function sortedUnique(values) {
  return [...new Set((values || []).map(String).filter(Boolean))].sort();
}

function decision(action, reason = null, details = {}) {
  return { action, ...(reason ? { reason } : {}), ...details };
}

function measurableProgress(signal = {}) {
  return Boolean(
    signal.phaseAdvanced ||
    signal.stateChanged ||
    signal.blockerRemoved ||
    signal.requiredEvidenceProduced ||
    signal.executionCompleted,
  );
}

function normalizeMutationAuthorizations(value = []) {
  const authorizations = new Map();
  if (!Array.isArray(value)) return authorizations;
  for (const entry of value) {
    const operationKey = String(entry?.operationKey || "").trim();
    if (!MUTATION_OPERATION_KEY_RE.test(operationKey)) continue;
    const trustedWorkflowIntent = entry?.trustedWorkflowIntent === true;
    const trustedExactTextConfirmation = entry?.trustedExactTextConfirmation === true;
    if (!trustedWorkflowIntent && !trustedExactTextConfirmation) continue;
    authorizations.set(operationKey, {
      operationKey,
      trustedWorkflowIntent,
      trustedExactTextConfirmation,
      authorizedAt: Number.isFinite(entry?.authorizedAt) ? entry.authorizedAt : null,
    });
  }
  return authorizations;
}

function normalizePreOpenGate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    decision: String(value.decision || ""),
    repo: String(value.repo || ""),
    baseRef: String(value.baseRef || ""),
    headRef: String(value.headRef || ""),
    baseSha: value.baseSha ? String(value.baseSha) : null,
    headSha: value.headSha ? String(value.headSha) : null,
    diffIdentity: value.diffIdentity ? String(value.diffIdentity) : null,
    fileCount: Number.isInteger(value.fileCount) ? value.fileCount : null,
    recordedAt: Number.isFinite(value.recordedAt) ? value.recordedAt : null,
  };
}

function sameIdentity(left, right) {
  return String(left || "").toLowerCase() === String(right || "").toLowerCase();
}

export function assertPreOpenPublicationEvidence(snapshot, request = null) {
  const workflow = String(snapshot?.workflow || "");
  if (!PRE_OPEN_WORKFLOWS.has(workflow)) return null;
  if (request && !PRE_OPEN_PUBLICATION_ACTIONS.has(String(request?.action || ""))) return null;

  const gate = normalizePreOpenGate(snapshot?.preOpenGate);
  if (!gate) throw new Error("pre_open_evidence_missing");
  if (gate.decision !== "ready") throw new Error("pre_open_evidence_not_ready");
  if (
    !gate.repo ||
    !gate.baseSha ||
    !gate.headSha ||
    !gate.diffIdentity ||
    !snapshot?.baseSha ||
    !snapshot?.headSha ||
    !sameIdentity(gate.repo, snapshot.repo) ||
    !sameIdentity(gate.baseSha, snapshot.baseSha) ||
    !sameIdentity(gate.headSha, snapshot.headSha)
  ) {
    throw new Error("pre_open_evidence_scope_mismatch");
  }
  if (
    request?.action === "push_code" &&
    !sameIdentity(request?.newTip, gate.headSha)
  ) {
    throw new Error("pre_open_evidence_scope_mismatch");
  }
  return structuredClone(gate);
}

export function createDeliveryWorkflowController(options = {}) {
  const snapshot = options.snapshot || null;
  const graph = normalizeGraph(options.graph || snapshot?.graph);
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const budgets = normalizeBudgets(snapshot?.budgets || options.budgets);

  const workflow = String(snapshot?.workflow || options.workflow || "").trim();
  const repo = String(snapshot?.repo || options.repo || "").trim();
  if (!workflow) throw new Error("workflow is required");
  if (!repo) throw new Error("repo is required");

  const initialPhase = String(snapshot?.phase || options.startPhase || "").trim();
  if (!initialPhase || !Object.hasOwn(graph, initialPhase)) {
    throw new Error(`start phase ${initialPhase || "(missing)"} is not in workflow graph`);
  }

  const startedAt = Number.isFinite(snapshot?.startedAt) ? snapshot.startedAt : now();
  let updatedAt = Number.isFinite(snapshot?.updatedAt) ? snapshot.updatedAt : startedAt;
  let phase = initialPhase;
  let issue = snapshot?.issue ?? options.issue ?? null;
  let pr = snapshot?.pr ?? options.pr ?? null;
  let baseSha = snapshot?.baseSha ?? options.baseSha ?? null;
  let headSha = snapshot?.headSha ?? options.headSha ?? null;
  let preOpenGate = normalizePreOpenGate(snapshot?.preOpenGate || options.preOpenGate);
  let stateGeneration = nonNegativeInteger(snapshot?.stateGeneration);
  const completedPhases = [...(snapshot?.completedPhases || [])].map(String);
  const blockers = new Set((snapshot?.blockers || []).map(String));
  const attempts = {
    workflowSteps: nonNegativeInteger(snapshot?.attempts?.workflowSteps),
    noProgressSteps: nonNegativeInteger(snapshot?.attempts?.noProgressSteps),
    phaseRetries: nonNegativeInteger(snapshot?.attempts?.phaseRetries),
    evidenceActions: nonNegativeInteger(snapshot?.attempts?.evidenceActions),
  };
  const usage = {
    workflowTokens: nonNegativeInteger(snapshot?.usage?.workflowTokens),
    phaseTokens: nonNegativeInteger(snapshot?.usage?.phaseTokens),
  };
  const evidenceRegistry = createEvidenceRegistry(snapshot?.evidenceRegistry || null);
  const mutationAuthorizations = normalizeMutationAuthorizations(
    snapshot?.mutationAuthorizations || options.mutationAuthorizations,
  );

  function touch() {
    updatedAt = now();
  }

  function snapshotState() {
    return {
      schemaVersion: 1,
      kind: "github-delivery/workflow-controller",
      workflow,
      repo,
      issue,
      pr,
      baseSha,
      headSha,
      preOpenGate: preOpenGate ? structuredClone(preOpenGate) : null,
      phase,
      graph,
      completedPhases: [...completedPhases],
      blockers: [...blockers].sort(),
      stateGeneration,
      attempts: { ...attempts },
      usage: { ...usage },
      budgets: { ...budgets },
      evidenceRegistry: evidenceRegistry.snapshot(),
      mutationAuthorizations: [...mutationAuthorizations.values()]
        .map((entry) => structuredClone(entry))
        .sort((left, right) => left.operationKey.localeCompare(right.operationKey)),
      startedAt,
      updatedAt,
    };
  }

  function setWorkflow(nextWorkflow) {
    const value = String(nextWorkflow || "").trim();
    if (value !== workflow) {
      throw new Error(`Workflow route is locked to ${workflow}; cannot reroute to ${value || "(empty)"}`);
    }
    return workflow;
  }

  function transition(nextPhase) {
    const target = String(nextPhase || "").trim();
    const allowed = graph[phase] || [];
    if (!allowed.includes(target)) {
      throw new Error(`Illegal workflow transition ${phase} -> ${target}`);
    }
    if (completedPhases.includes(target)) {
      throw new Error(`Cannot transition back into completed phase ${target}`);
    }
    if (target === "OPEN_PR" && PRE_OPEN_WORKFLOWS.has(workflow)) {
      assertPreOpenPublicationEvidence(snapshotState());
    }
    if (!completedPhases.includes(phase)) completedPhases.push(phase);
    phase = target;
    attempts.noProgressSteps = 0;
    attempts.phaseRetries = 0;
    usage.phaseTokens = 0;
    touch();
    return snapshotState();
  }

  function observeCycle(signal = {}) {
    attempts.workflowSteps += 1;
    if (measurableProgress(signal)) attempts.noProgressSteps = 0;
    else attempts.noProgressSteps += 1;
    touch();

    if (attempts.workflowSteps >= budgets.maxWorkflowSteps) {
      return decision("interrupt", "workflow_step_limit", {
        workflowSteps: attempts.workflowSteps,
        limit: budgets.maxWorkflowSteps,
      });
    }
    if (attempts.noProgressSteps >= budgets.noProgressInterrupt) {
      return decision("interrupt", "workflow_no_progress_limit", {
        noProgressSteps: attempts.noProgressSteps,
      });
    }
    if (attempts.noProgressSteps >= budgets.noProgressRestrictEvidence) {
      return decision("restrict-evidence", "workflow_no_progress_evidence_restricted", {
        noProgressSteps: attempts.noProgressSteps,
      });
    }
    if (attempts.noProgressSteps >= budgets.noProgressWarn) {
      return decision("warn", "workflow_no_progress_warning", {
        noProgressSteps: attempts.noProgressSteps,
      });
    }
    return decision("allow");
  }

  function recordPhaseRetry() {
    attempts.phaseRetries += 1;
    touch();
    if (attempts.phaseRetries >= budgets.maxPhaseRetries) {
      return decision("interrupt", "phase_retry_limit", {
        phaseRetries: attempts.phaseRetries,
        limit: budgets.maxPhaseRetries,
      });
    }
    return decision("allow");
  }

  function recordEvidenceAction() {
    attempts.evidenceActions += 1;
    touch();
    if (attempts.evidenceActions >= budgets.maxEvidenceActions) {
      return decision("restrict-evidence", "workflow_evidence_limit", {
        evidenceActions: attempts.evidenceActions,
        limit: budgets.maxEvidenceActions,
      });
    }
    return decision("allow");
  }

  function observeResourceUsage({ workflowTokens, phaseTokens, now: observedAt } = {}) {
    if (Number.isInteger(workflowTokens) && workflowTokens >= 0) usage.workflowTokens = workflowTokens;
    if (Number.isInteger(phaseTokens) && phaseTokens >= 0) usage.phaseTokens = phaseTokens;
    const at = Number.isFinite(observedAt) ? observedAt : now();
    updatedAt = at;

    if (usage.workflowTokens > budgets.maxWorkflowTokens) {
      return decision("interrupt", "workflow_token_limit", {
        workflowTokens: usage.workflowTokens,
        limit: budgets.maxWorkflowTokens,
      });
    }
    if (usage.phaseTokens > budgets.maxPhaseTokens) {
      return decision("interrupt", "phase_token_limit", {
        phaseTokens: usage.phaseTokens,
        limit: budgets.maxPhaseTokens,
      });
    }
    if (at - startedAt > budgets.maxWallTimeMs) {
      return decision("interrupt", "workflow_wall_time_limit", {
        elapsedMs: at - startedAt,
        limit: budgets.maxWallTimeMs,
      });
    }
    return decision("allow");
  }

  function addBlocker(blocker) {
    const value = String(blocker || "").trim();
    if (value) blockers.add(value);
    touch();
    return snapshotState();
  }

  function removeBlocker(blocker) {
    const removed = blockers.delete(String(blocker || ""));
    touch();
    return removed;
  }

  function authorizeMutation({
    operationKey,
    trustedWorkflowIntent = false,
    trustedExactTextConfirmation = false,
  } = {}) {
    const key = String(operationKey || "").trim();
    if (!MUTATION_OPERATION_KEY_RE.test(key)) {
      throw new Error("mutation_operation_key_invalid");
    }
    const workflowIntent = trustedWorkflowIntent === true;
    const exactTextConfirmation = trustedExactTextConfirmation === true;
    if (!workflowIntent && !exactTextConfirmation) {
      throw new Error("mutation_authorization_context_required");
    }
    const authorization = {
      operationKey: key,
      trustedWorkflowIntent: workflowIntent,
      trustedExactTextConfirmation: exactTextConfirmation,
      authorizedAt: now(),
    };
    mutationAuthorizations.set(key, authorization);
    touch();
    return structuredClone(authorization);
  }

  function updateRefs(next = {}) {
    let changed = false;
    if (Object.hasOwn(next, "baseSha") && next.baseSha !== baseSha) {
      baseSha = next.baseSha || null;
      changed = true;
    }
    if (Object.hasOwn(next, "headSha") && next.headSha !== headSha) {
      headSha = next.headSha || null;
      changed = true;
    }
    if (Object.hasOwn(next, "issue") && next.issue !== issue) {
      issue = next.issue;
      changed = true;
    }
    if (Object.hasOwn(next, "pr") && next.pr !== pr) {
      pr = next.pr;
      changed = true;
    }
    if (changed) {
      stateGeneration += 1;
      attempts.noProgressSteps = 0;
    }
    touch();
    return { changed, stateGeneration };
  }

  function reconcileMutationResult(result = {}) {
    const results = Array.isArray(result?.results) ? result.results : [result];
    const pushes = results.filter((entry) =>
      entry?.action === "push_code" &&
      ["succeeded", "already_applied", "reconciled_after_error"].includes(entry?.status) &&
      entry?.request?.newTip,
    );
    if (pushes.length === 0) {
      return { changed: false, stateGeneration, headSha };
    }
    const applicable = pushes.filter(
      (entry) => String(entry.request?.repo || "").toLowerCase() === repo.toLowerCase(),
    );
    if (applicable.length !== pushes.length) {
      throw new Error("mutation_result_repo_mismatch");
    }
    const tips = [...new Set(applicable.map((entry) => String(entry.request.newTip)))];
    if (tips.length !== 1) {
      throw new Error("mutation_result_head_ambiguous");
    }
    const updated = updateRefs({ headSha: tips[0] });
    return { ...updated, headSha };
  }

  function recordPreOpenGate(result = {}) {
    if (!PRE_OPEN_WORKFLOWS.has(workflow)) {
      throw new Error("pre_open_evidence_not_required");
    }
    if (!["PREOPEN_GATE", "OPEN_PR"].includes(phase)) {
      throw new Error("pre_open_evidence_phase_invalid");
    }
    const record = normalizePreOpenGate({
      decision: result.decision,
      repo: result.repo,
      baseRef: result.baseRef,
      headRef: result.headRef,
      baseSha: result.baseRefOid ?? result.baseSha,
      headSha: result.headRefOid ?? result.headSha,
      diffIdentity: result.diffIdentity,
      fileCount: result.fileCount,
      recordedAt: now(),
    });
    if (!record?.repo || !sameIdentity(record.repo, repo)) {
      throw new Error("pre_open_evidence_scope_mismatch");
    }
    preOpenGate = record;
    touch();
    return structuredClone(record);
  }

  function recordEvidence(entry) {
    const result = evidenceRegistry.record({
      ...entry,
      stateGeneration,
    });
    touch();
    return result;
  }

  function decideEvidence(request) {
    return evidenceRegistry.decide({
      ...request,
      stateGeneration,
    });
  }

  return {
    setWorkflow,
    transition,
    observeCycle,
    recordPhaseRetry,
    recordEvidenceAction,
    observeResourceUsage,
    addBlocker,
    removeBlocker,
    authorizeMutation,
    updateRefs,
    reconcileMutationResult,
    recordPreOpenGate,
    recordEvidence,
    decideEvidence,
    snapshot: snapshotState,
  };
}

export function writeDeliveryWorkflowCheckpoint(path, snapshot) {
  if (!path) throw new Error("checkpoint path is required");
  if (!snapshot || snapshot.kind !== "github-delivery/workflow-controller") {
    throw new Error("valid workflow controller snapshot is required");
  }
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

export function readDeliveryWorkflowCheckpoint(path) {
  if (!path) throw new Error("checkpoint path is required");
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (parsed?.schemaVersion !== 1 || parsed?.kind !== "github-delivery/workflow-controller") {
    throw new Error("invalid workflow controller checkpoint");
  }
  return parsed;
}
