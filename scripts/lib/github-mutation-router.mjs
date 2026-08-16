import {
  executeMutationRequest as executeLegacyMutationRequest,
  planMutationRequest as planLegacyMutationRequest,
} from "./github-mutation-broker.mjs";
import {
  executeLifecycleMutationRequest,
  isLifecycleMutationAction,
  planLifecycleMutationRequest,
} from "./github-lifecycle-mutation-broker.mjs";
import { makeGitHubBodyTransportRunner } from "./github-body-transport.mjs";
import { makeIdempotencyReceiptRunner } from "./idempotency-receipt-runner.mjs";
import { verifyLegacyMutationPostcondition } from "./mutation-postconditions.mjs";
import { boundedSpawnSync } from "./subprocess-policy.mjs";

export function planMutationRequest(request = {}, options = {}) {
  return isLifecycleMutationAction(request.action)
    ? planLifecycleMutationRequest(request, options)
    : planLegacyMutationRequest(request, options);
}

export function executeMutationRequest(options = {}) {
  const baseRunner =
    typeof options.runner === "function" ? options.runner : boundedSpawnSync;
  const bodySafeRunner = makeGitHubBodyTransportRunner(baseRunner);

  if (isLifecycleMutationAction(options?.request?.action)) {
    return executeLifecycleMutationRequest({
      ...options,
      runner: bodySafeRunner,
    });
  }

  // Plan once to obtain the exact normalized idempotency marker/body that the
  // legacy broker will use. The wrapped runner then removes forged marker hits
  // from the broker's remote read-before-write evidence.
  const planned = planLegacyMutationRequest(options?.request || {}, options);
  const runner = makeIdempotencyReceiptRunner({
    request: planned.request,
    runner: bodySafeRunner,
  });
  const receipt = executeLegacyMutationRequest({
    ...options,
    runner,
  });
  const postcondition = verifyLegacyMutationPostcondition({
    request: planned.request,
    receipt,
    runner,
  });
  return postcondition ? { ...receipt, postcondition } : receipt;
}
