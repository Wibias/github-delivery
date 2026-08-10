import {
  executeMutationRequest as executeLegacyMutationRequest,
  planMutationRequest as planLegacyMutationRequest,
} from "./github-mutation-broker.mjs";
import {
  executeLifecycleMutationRequest,
  isLifecycleMutationAction,
  planLifecycleMutationRequest,
} from "./github-lifecycle-mutation-broker.mjs";
import { makeIdempotencyReceiptRunner } from "./idempotency-receipt-runner.mjs";
import { boundedSpawnSync } from "./subprocess-policy.mjs";

export function planMutationRequest(request = {}, options = {}) {
  return isLifecycleMutationAction(request.action)
    ? planLifecycleMutationRequest(request, options)
    : planLegacyMutationRequest(request, options);
}

export function executeMutationRequest(options = {}) {
  if (isLifecycleMutationAction(options?.request?.action)) {
    return executeLifecycleMutationRequest({
      ...options,
      runner: typeof options.runner === "function" ? options.runner : boundedSpawnSync,
    });
  }

  // Plan once to obtain the exact normalized idempotency marker/body that the
  // legacy broker will use. The wrapped runner then removes forged marker hits
  // from the broker's remote read-before-write evidence.
  const planned = planLegacyMutationRequest(options?.request || {}, options);
  const baseRunner =
    typeof options.runner === "function" ? options.runner : boundedSpawnSync;
  const runner = makeIdempotencyReceiptRunner({
    request: planned.request,
    runner: baseRunner,
  });
  return executeLegacyMutationRequest({
    ...options,
    runner,
  });
}
