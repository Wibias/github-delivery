import { resolveDeliveryWorkflowProfile } from "./delivery-workflow-profiles.mjs";
import {
  createDeliveryWorkflowController,
  readDeliveryWorkflowCheckpoint,
  writeDeliveryWorkflowCheckpoint,
} from "./delivery-workflow-controller.mjs";

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
