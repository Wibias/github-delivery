#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  createDeliveryWorkflowController,
  readDeliveryWorkflowCheckpoint,
  writeDeliveryWorkflowCheckpoint,
} from "./lib/delivery-workflow-controller.mjs";
import { resolveDeliveryWorkflowProfile } from "./lib/delivery-workflow-profiles.mjs";
import {
  mutationOperationKey,
  requestsFromMutationDocument,
} from "./lib/mutation-document-execution.mjs";
import { mutationRequiresIndependentIntent } from "./lib/mutation-policy.mjs";
import { readUserConfig, resolveAuthorityMode } from "./lib/user-config.mjs";
import { allowedMutationModes } from "./lib/workflow-mode.mjs";

const USAGE = `Usage:
  node scripts/delivery-controller.mjs start WORKFLOW --repo OWNER/REPO --checkpoint FILE [--issue N] [--pr N] [--base SHA] [--head SHA]
  node scripts/delivery-controller.mjs transition CHECKPOINT PHASE
  node scripts/delivery-controller.mjs cycle CHECKPOINT [--state-changed] [--blocker-removed] [--required-evidence-produced] [--execution-completed]
  node scripts/delivery-controller.mjs retry CHECKPOINT
  node scripts/delivery-controller.mjs evidence-action CHECKPOINT
  node scripts/delivery-controller.mjs usage CHECKPOINT --workflow-tokens N --phase-tokens N
  node scripts/delivery-controller.mjs refs CHECKPOINT [--base SHA] [--head SHA]
  node scripts/delivery-controller.mjs authorize-mutation CHECKPOINT --request FILE [--workflow-intent] [--exact-text-confirmed]
  node scripts/delivery-controller.mjs blocker-add CHECKPOINT BLOCKER
  node scripts/delivery-controller.mjs blocker-remove CHECKPOINT BLOCKER
  node scripts/delivery-controller.mjs show CHECKPOINT`;

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} requires a positive integer`);
  return parsed;
}

function nonNegativeInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${label} requires a non-negative integer`);
  return parsed;
}

function takeOption(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  if (index + 1 >= argv.length) throw new Error(`${name} requires a value`);
  const value = argv[index + 1];
  argv.splice(index, 2);
  return value;
}

function takeFlag(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return false;
  argv.splice(index, 1);
  return true;
}

function assertEmpty(argv) {
  if (argv.length) throw new Error(`Unknown arguments: ${argv.join(" ")}\n${USAGE}`);
}

function effectiveAuthorityMode() {
  const { config } = readUserConfig();
  return resolveAuthorityMode({ config, env: process.env });
}

function load(path) {
  const checkpoint = resolve(path);
  const snapshot = readDeliveryWorkflowCheckpoint(checkpoint);
  const profile = resolveDeliveryWorkflowProfile(snapshot.workflow);
  return {
    checkpoint,
    controller: createDeliveryWorkflowController({
      snapshot,
      graph: profile.graph,
    }),
  };
}

function persist(loaded) {
  const snapshot = loaded.controller.snapshot();
  writeDeliveryWorkflowCheckpoint(loaded.checkpoint, snapshot);
  return snapshot;
}

function print(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function authorizeMutationRequest(loaded, request, context) {
  const snapshot = loaded.controller.snapshot();
  if (String(request?.repo || "").toLowerCase() !== String(snapshot.repo || "").toLowerCase()) {
    throw new Error("mutation_checkpoint_repo_mismatch");
  }
  if (
    snapshot.pr !== null &&
    snapshot.pr !== undefined &&
    request?.pr !== null &&
    request?.pr !== undefined &&
    Number(request.pr) !== Number(snapshot.pr)
  ) {
    throw new Error("mutation_checkpoint_pr_mismatch");
  }
  if (
    snapshot.headSha &&
    request?.expectedHead &&
    String(request.expectedHead).toLowerCase() !== String(snapshot.headSha).toLowerCase()
  ) {
    throw new Error("mutation_checkpoint_head_mismatch");
  }

  const workflowPath = `references/${snapshot.workflow}.md`;
  const workflowModes = allowedMutationModes(workflowPath);
  if (
    workflowModes &&
    !workflowModes.includes(String(request?.mutationMode || "read-only").toLowerCase())
  ) {
    throw new Error("mutation_checkpoint_mode_mismatch");
  }
  if (
    context.trustedWorkflowIntent &&
    effectiveAuthorityMode() === "off"
  ) {
    throw new Error("mutation_workflow_intent_is_controller_owned");
  }
  if (context.trustedWorkflowIntent && !mutationRequiresIndependentIntent(request)) {
    throw new Error("mutation_workflow_intent_not_required");
  }
  if (
    context.trustedExactTextConfirmation &&
    String(request?.action || "") !== "reply_human_thread"
  ) {
    throw new Error("mutation_exact_text_context_invalid");
  }

  return loaded.controller.authorizeMutation({
    operationKey: mutationOperationKey(request),
    ...context,
  });
}

try {
  const argv = process.argv.slice(2);
  const command = argv.shift();
  if (!command) throw new Error(USAGE);

  if (command === "start") {
    const workflow = argv.shift();
    if (!workflow) throw new Error(USAGE);
    const repo = takeOption(argv, "--repo");
    const checkpointValue = takeOption(argv, "--checkpoint");
    const issueRaw = takeOption(argv, "--issue");
    const prRaw = takeOption(argv, "--pr");
    const baseSha = takeOption(argv, "--base");
    const headSha = takeOption(argv, "--head");
    assertEmpty(argv);
    if (!repo || !checkpointValue) throw new Error("start requires --repo and --checkpoint");
    const profile = resolveDeliveryWorkflowProfile(workflow);
    const checkpoint = resolve(checkpointValue);
    const controller = createDeliveryWorkflowController({
      workflow: profile.workflow,
      repo,
      issue: issueRaw === null ? null : positiveInteger(issueRaw, "--issue"),
      pr: prRaw === null ? null : positiveInteger(prRaw, "--pr"),
      baseSha,
      headSha,
      graph: profile.graph,
      startPhase: profile.startPhase,
    });
    const snapshot = controller.snapshot();
    writeDeliveryWorkflowCheckpoint(checkpoint, snapshot);
    print(snapshot);
  } else if (command === "show") {
    const checkpoint = argv.shift();
    if (!checkpoint) throw new Error(USAGE);
    assertEmpty(argv);
    print(readDeliveryWorkflowCheckpoint(resolve(checkpoint)));
  } else {
    const checkpointValue = argv.shift();
    if (!checkpointValue) throw new Error(USAGE);
    const loaded = load(checkpointValue);
    let result;

    if (command === "transition") {
      const phase = argv.shift();
      if (!phase) throw new Error(USAGE);
      assertEmpty(argv);
      result = loaded.controller.transition(phase);
    } else if (command === "cycle") {
      const signal = {
        stateChanged: takeFlag(argv, "--state-changed"),
        blockerRemoved: takeFlag(argv, "--blocker-removed"),
        requiredEvidenceProduced: takeFlag(argv, "--required-evidence-produced"),
        executionCompleted: takeFlag(argv, "--execution-completed"),
      };
      assertEmpty(argv);
      result = loaded.controller.observeCycle(signal);
    } else if (command === "retry") {
      assertEmpty(argv);
      result = loaded.controller.recordPhaseRetry();
    } else if (command === "evidence-action") {
      assertEmpty(argv);
      result = loaded.controller.recordEvidenceAction();
    } else if (command === "usage") {
      const workflowTokens = takeOption(argv, "--workflow-tokens");
      const phaseTokens = takeOption(argv, "--phase-tokens");
      assertEmpty(argv);
      result = loaded.controller.observeResourceUsage({
        workflowTokens: workflowTokens === null ? undefined : nonNegativeInteger(workflowTokens, "--workflow-tokens"),
        phaseTokens: phaseTokens === null ? undefined : nonNegativeInteger(phaseTokens, "--phase-tokens"),
      });
    } else if (command === "refs") {
      const baseSha = takeOption(argv, "--base");
      const headSha = takeOption(argv, "--head");
      assertEmpty(argv);
      result = loaded.controller.updateRefs({
        ...(baseSha !== null ? { baseSha } : {}),
        ...(headSha !== null ? { headSha } : {}),
      });
    } else if (command === "authorize-mutation") {
      const requestPath = takeOption(argv, "--request");
      const trustedWorkflowIntent = takeFlag(argv, "--workflow-intent");
      const trustedExactTextConfirmation = takeFlag(argv, "--exact-text-confirmed");
      assertEmpty(argv);
      if (!requestPath) throw new Error("authorize-mutation requires --request");
      const document = JSON.parse(readFileSync(resolve(requestPath), "utf8"));
      const normalized = requestsFromMutationDocument(document);
      if (normalized.requests.length !== 1) {
        throw new Error("authorize-mutation requires exactly one mutation request");
      }
      result = authorizeMutationRequest(loaded, normalized.requests[0], {
        trustedWorkflowIntent,
        trustedExactTextConfirmation,
      });
    } else if (command === "blocker-add") {
      const blocker = argv.shift();
      if (!blocker) throw new Error(USAGE);
      assertEmpty(argv);
      result = loaded.controller.addBlocker(blocker);
    } else if (command === "blocker-remove") {
      const blocker = argv.shift();
      if (!blocker) throw new Error(USAGE);
      assertEmpty(argv);
      result = { removed: loaded.controller.removeBlocker(blocker) };
    } else {
      throw new Error(USAGE);
    }

    const snapshot = persist(loaded);
    print({
      schemaVersion: 1,
      kind: "github-delivery/workflow-controller-command",
      command,
      result,
      snapshot,
    });
    if (result?.action === "interrupt") process.exitCode = 3;
    else if (result?.action === "restrict-evidence") process.exitCode = 4;
  }
} catch (error) {
  console.error(String(error?.message || error));
  process.exitCode = 2;
}
