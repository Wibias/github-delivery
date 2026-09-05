import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  createDeliveryWorkflowController,
  readDeliveryWorkflowCheckpoint,
} from "./delivery-workflow-controller.mjs";
import { resolveDeliveryWorkflowProfile } from "./delivery-workflow-profiles.mjs";

const LOCAL_PR_WORKFLOW = "create-pr-from-local-work";
const HEAD_RE = /^[0-9a-f]{40,64}$/i;
const REPO_RE = /^[^/\s]+\/[^/\s]+$/;

function normalizeRepo(repo) {
  const value = String(repo || "").trim();
  if (!REPO_RE.test(value)) throw new Error("workflow_bootstrap_repo_invalid");
  return value;
}

function normalizeHead(headSha) {
  const value = String(headSha || "").trim().toLowerCase();
  if (!HEAD_RE.test(value)) throw new Error("workflow_bootstrap_head_invalid");
  return value;
}

function stateRoot(override) {
  return resolve(
    override || process.env.GITHUB_DELIVERY_STATE_DIR || join(homedir(), ".github-delivery"),
  );
}

function checkpointIdentity({ workflow, repo, headSha }) {
  return JSON.stringify({
    schemaVersion: 1,
    workflow,
    repo: repo.toLowerCase(),
    headSha: headSha.toLowerCase(),
  });
}

export function localPrWorkflowCheckpointPath({ repo, headSha, stateDir } = {}) {
  const normalizedRepo = normalizeRepo(repo);
  const normalizedHead = normalizeHead(headSha);
  const digest = createHash("sha256")
    .update(checkpointIdentity({
      workflow: LOCAL_PR_WORKFLOW,
      repo: normalizedRepo,
      headSha: normalizedHead,
    }))
    .digest("hex");
  return join(stateRoot(stateDir), "workflow-checkpoints", `${digest}.json`);
}

function assertCheckpointIdentity(snapshot, { repo, headSha }) {
  if (
    snapshot?.workflow !== LOCAL_PR_WORKFLOW ||
    String(snapshot?.repo || "").toLowerCase() !== repo.toLowerCase() ||
    String(snapshot?.headSha || "").toLowerCase() !== headSha.toLowerCase()
  ) {
    throw new Error("workflow_bootstrap_checkpoint_identity_mismatch");
  }
}

export function bootstrapLocalPrWorkflow({ repo, headSha, baseSha = null, stateDir } = {}) {
  const normalizedRepo = normalizeRepo(repo);
  const normalizedHead = normalizeHead(headSha);
  const checkpointPath = localPrWorkflowCheckpointPath({
    repo: normalizedRepo,
    headSha: normalizedHead,
    stateDir,
  });
  const profile = resolveDeliveryWorkflowProfile(LOCAL_PR_WORKFLOW);
  const initialSnapshot = createDeliveryWorkflowController({
    workflow: profile.workflow,
    repo: normalizedRepo,
    baseSha: baseSha ? String(baseSha) : null,
    headSha: normalizedHead,
    graph: profile.graph,
    startPhase: profile.startPhase,
  }).snapshot();

  mkdirSync(dirname(checkpointPath), { recursive: true });
  let reused = false;
  try {
    writeFileSync(checkpointPath, `${JSON.stringify(initialSnapshot, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    reused = true;
  }

  const snapshot = readDeliveryWorkflowCheckpoint(checkpointPath);
  assertCheckpointIdentity(snapshot, {
    repo: normalizedRepo,
    headSha: normalizedHead,
  });
  if (
    baseSha &&
    snapshot.baseSha &&
    String(snapshot.baseSha).toLowerCase() !== String(baseSha).toLowerCase()
  ) {
    throw new Error("workflow_bootstrap_checkpoint_base_mismatch");
  }

  return {
    checkpointPath,
    reused,
    snapshot,
  };
}
