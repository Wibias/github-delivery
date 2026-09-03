import { createHash } from "node:crypto";

import {
  assertCreatePrPublicationRequest,
  createPrPublicationPlanLock,
  reconcileCreatePrPublicationReceipts,
} from "./create-pr-publication-state.mjs";
import { resolveDeliveryWorkflowProfile } from "./delivery-workflow-profiles.mjs";
import {
  assertPreOpenHygieneEvidence,
  assertPreOpenPublicationEvidence,
  createDeliveryWorkflowController,
  readDeliveryWorkflowCheckpoint,
  writeDeliveryWorkflowCheckpoint,
} from "./delivery-workflow-controller.mjs";
import { mutationOperationKey } from "./mutation-document-execution.mjs";

const EMPTY_EXECUTION_CONTEXT = Object.freeze({
  trustedWorkflowIntent: false,
  trustedExactTextConfirmation: false,
});

const ROUTED_WORKFLOW_INTENT = Object.freeze({
  "create-pr-for-issue": Object.freeze({
    OPEN_PR: Object.freeze(new Set(["create_pr"])),
  }),
  "create-pr-from-local-work": Object.freeze({
    OPEN_PR: Object.freeze(new Set(["create_pr"])),
  }),
});
const PRE_OPEN_WORKFLOWS = new Set([
  "create-pr-for-issue",
  "create-pr-from-local-work",
]);
const PRE_OPEN_PUBLICATION_ACTIONS = new Set(["push_code", "create_pr"]);

function routedWorkflowIntentSlot(snapshot, request) {
  const workflow = String(snapshot?.workflow || "");
  const phase = String(snapshot?.phase || "");
  const action = String(request?.action || "");
  if (ROUTED_WORKFLOW_INTENT[workflow]?.[phase]?.has(action) !== true) {
    return null;
  }
  return `${workflow}:${phase}:${action}`;
}

function routedWorkflowIntentMarkerKey(slot) {
  const digest = createHash("sha256")
    .update(`github-delivery:routed-workflow-intent:${slot}`, "utf8")
    .digest("hex");
  return `payload:${digest}`;
}

function mutationAuthorization(snapshot, operationKey) {
  return Array.isArray(snapshot?.mutationAuthorizations)
    ? snapshot.mutationAuthorizations.find(
        (entry) => String(entry?.operationKey || "") === operationKey,
      )
    : null;
}

function ensureRoutedWorkflowIntent({ path, snapshot, request, operationKey }) {
  const slot = routedWorkflowIntentSlot(snapshot, request);
  if (!slot) return false;

  const markerKey = routedWorkflowIntentMarkerKey(slot);
  const marker = mutationAuthorization(snapshot, markerKey);
  const authorization = mutationAuthorization(snapshot, operationKey);

  if (marker?.trustedWorkflowIntent === true) {
    if (authorization?.trustedWorkflowIntent === true) return true;
    throw new Error("mutation_workflow_intent_operation_mismatch");
  }

  const profile = resolveDeliveryWorkflowProfile(snapshot.workflow);
  const controller = createDeliveryWorkflowController({
    snapshot,
    graph: profile.graph,
  });
  controller.authorizeMutation({
    operationKey: markerKey,
    trustedWorkflowIntent: true,
  });
  controller.authorizeMutation({
    operationKey,
    trustedWorkflowIntent: true,
  });
  writeDeliveryWorkflowCheckpoint(path, controller.snapshot());
  return true;
}

function assertPublicationCheckpoint(snapshot, request) {
  if (!PRE_OPEN_WORKFLOWS.has(String(snapshot?.workflow || ""))) return;
  if (!PRE_OPEN_PUBLICATION_ACTIONS.has(String(request?.action || ""))) return;
  if (String(snapshot?.phase || "") !== "OPEN_PR") {
    throw new Error("pre_open_publication_phase_invalid");
  }
  assertPreOpenHygieneEvidence(snapshot, request);
  assertPreOpenPublicationEvidence(snapshot, request);
  assertCreatePrPublicationRequest(snapshot, request);
  if (request?.action === "create_pr" && request?.draft !== true) {
    throw new Error("routed_create_pr_requires_draft");
  }
}

export function lockCreatePrPublicationPlanCheckpoint({ path, plan } = {}) {
  if (!path) throw new Error("checkpoint path is required");
  const snapshot = readDeliveryWorkflowCheckpoint(path);
  if (String(snapshot.workflow || "") !== "create-pr-from-local-work") {
    throw new Error("create_pr_publication_plan_not_required");
  }
  if (!["PREOPEN_GATE", "OPEN_PR"].includes(String(snapshot.phase || ""))) {
    throw new Error("create_pr_publication_plan_phase_invalid");
  }
  const lock = createPrPublicationPlanLock(plan, { headSha: snapshot.headSha });
  if (snapshot.publicationPlan) {
    const existing = JSON.stringify(snapshot.publicationPlan);
    const next = JSON.stringify(lock);
    if (existing !== next) throw new Error("create_pr_publication_plan_already_locked");
    return structuredClone(snapshot.publicationPlan);
  }
  snapshot.publicationPlan = lock;
  snapshot.publicationReceipts = {};
  writeDeliveryWorkflowCheckpoint(path, snapshot);
  return structuredClone(lock);
}

export function mutationExecutionContextFromCheckpoint({ path, request } = {}) {
  if (!path) return { ...EMPTY_EXECUTION_CONTEXT };
  const snapshot = readDeliveryWorkflowCheckpoint(path);
  const requestRepo = String(request?.repo || "").trim();
  if (
    requestRepo &&
    String(snapshot.repo || "").toLowerCase() !== requestRepo.toLowerCase()
  ) {
    throw new Error("mutation_checkpoint_repo_mismatch");
  }
  assertPublicationCheckpoint(snapshot, request);
  const operationKey = mutationOperationKey(request);
  const routedWorkflowIntent = ensureRoutedWorkflowIntent({
    path,
    snapshot,
    request,
    operationKey,
  });
  const authorization = mutationAuthorization(snapshot, operationKey);
  return {
    trustedWorkflowIntent:
      routedWorkflowIntent || authorization?.trustedWorkflowIntent === true,
    trustedExactTextConfirmation:
      authorization?.trustedExactTextConfirmation === true,
  };
}

export function reconcileMutationCheckpoint({ path, output } = {}) {
  if (!path) return { changed: false, checkpoint: null };
  const snapshot = readDeliveryWorkflowCheckpoint(path);
  const publication = reconcileCreatePrPublicationReceipts(snapshot, output);
  if (publication.changed) snapshot.publicationReceipts = publication.receipts;

  const profile = resolveDeliveryWorkflowProfile(snapshot.workflow);
  const controller = createDeliveryWorkflowController({
    snapshot,
    graph: profile.graph,
  });
  const result = controller.reconcileMutationResult(output);
  const changed = result.changed || publication.changed;
  if (changed) {
    writeDeliveryWorkflowCheckpoint(path, controller.snapshot());
  }
  return {
    ...result,
    changed,
    checkpoint: path,
  };
}
