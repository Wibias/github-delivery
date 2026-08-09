import {
  executeMutationRequest as executeLegacyMutationRequest,
  planMutationRequest as planLegacyMutationRequest,
} from "./github-mutation-broker.mjs";
import {
  executeLifecycleMutationRequest,
  isLifecycleMutationAction,
  planLifecycleMutationRequest,
} from "./github-lifecycle-mutation-broker.mjs";

export function planMutationRequest(request = {}, options = {}) {
  return isLifecycleMutationAction(request.action)
    ? planLifecycleMutationRequest(request, options)
    : planLegacyMutationRequest(request, options);
}

export function executeMutationRequest(options = {}) {
  return isLifecycleMutationAction(options?.request?.action)
    ? executeLifecycleMutationRequest(options)
    : executeLegacyMutationRequest(options);
}
