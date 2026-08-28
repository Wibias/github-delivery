import {
  executeApprovalMutationRequest,
  planApprovalMutationRequest,
} from "./github-approval-mutation-broker.mjs";
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
  if (request.action === "approve_pr") {
    return planApprovalMutationRequest(request, options);
  }
  return isLifecycleMutationAction(request.action)
    ? planLifecycleMutationRequest(request, options)
    : planLegacyMutationRequest(request, options);
}

export function executeMutationRequest(options = {}) {
  const baseRunner =
    typeof options.runner === "function" ? options.runner : boundedSpawnSync;
  const bodySafeRunner = makeGitHubBodyTransportRunner(baseRunner);

  if (options?.request?.action === "approve_pr") {
    return executeApprovalMutationRequest({
      ...options,
      runner: bodySafeRunner,
    });
  }

  if (isLifecycleMutationAction(options?.request?.action)) {
    return executeLifecycleMutationRequest({
      ...options,
      runner: bodySafeRunner,
    });
  }

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
    runner: bodySafeRunner,
  });
  return postcondition ? { ...receipt, postcondition } : receipt;
}
