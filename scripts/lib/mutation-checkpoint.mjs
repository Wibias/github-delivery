import { resolveDeliveryWorkflowProfile } from "./delivery-workflow-profiles.mjs";
import {
  createDeliveryWorkflowController,
  readDeliveryWorkflowCheckpoint,
  writeDeliveryWorkflowCheckpoint,
} from "./delivery-workflow-controller.mjs";
import { mutationOperationKey } from "./mutation-document-execution.mjs";

const EMPTY_EXECUTION_CONTEXT = Object.freeze({
  trustedWorkflowIntent: false,
  trustedExactTextConfirmation: false,
});

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
  const operationKey = mutationOperationKey(request);
  const authorization = Array.isArray(snapshot.mutationAuthorizations)
    ? snapshot.mutationAuthorizations.find(
        (entry) => String(entry?.operationKey || "") === operationKey,
      )
    : null;
  return {
    trustedWorkflowIntent: authorization?.trustedWorkflowIntent === true,
    trustedExactTextConfirmation:
      authorization?.trustedExactTextConfirmation === true,
  };
}

export function reconcileMutationCheckpoint({ path, output } = {}) {
  if (!path) return { changed: false, checkpoint: null };
  const snapshot = readDeliveryWorkflowCheckpoint(path);
  const profile = resolveDeliveryWorkflowProfile(snapshot.workflow);
  const controller = createDeliveryWorkflowController({
    snapshot,
    graph: profile.graph,
  });
  const result = controller.reconcileMutationResult(output);
  if (result.changed) {
    writeDeliveryWorkflowCheckpoint(path, controller.snapshot());
  }
  return {
    ...result,
    checkpoint: path,
  };
}
