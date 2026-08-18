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
      phase,
      graph,
      completedPhases: [...completedPhases],
      blockers: [...blockers].sort(),
      stateGeneration,
      attempts: { ...attempts },
      usage: { ...usage },
      budgets: { ...budgets },
      evidenceRegistry: evidenceRegistry.snapshot(),
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
    updateRefs,
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
