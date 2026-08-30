import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  createDeliveryWorkflowController,
  readDeliveryWorkflowCheckpoint,
  writeDeliveryWorkflowCheckpoint,
} from "../../scripts/lib/delivery-workflow-controller.mjs";
import { resolveDeliveryWorkflowProfile } from "../../scripts/lib/delivery-workflow-profiles.mjs";
import {
  executeMutationDocument,
  mutationOperationKey,
} from "../../scripts/lib/mutation-document-execution.mjs";
import { mutationExecutionContextFromCheckpoint } from "../../scripts/lib/mutation-checkpoint.mjs";

const PRE_OPEN_GATE = fileURLToPath(
  new URL("../../scripts/pre-open-gate.mjs", import.meta.url),
);
const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);
const NEXT_HEAD = "c".repeat(40);
const GRAPH = {
  PREOPEN_GATE: ["OPEN_PR"],
  OPEN_PR: ["DONE"],
  DONE: [],
};

function readyGate(overrides = {}) {
  return {
    decision: "ready",
    repo: "acme/widgets",
    baseRef: "dev",
    headRef: "task",
    baseRefOid: BASE,
    headRefOid: HEAD,
    diffIdentity: `sha256:${"d".repeat(64)}`,
    fileCount: 6,
    ...overrides,
  };
}

function controller(startPhase = "PREOPEN_GATE") {
  return createDeliveryWorkflowController({
    workflow: "create-pr-for-issue",
    repo: "acme/widgets",
    baseSha: BASE,
    headSha: HEAD,
    graph: GRAPH,
    startPhase,
  });
}

function pushRequest(newTip = HEAD) {
  return {
    schemaVersion: 1,
    action: "push_code",
    mutationMode: "maintainer",
    explicitInstruction: false,
    repo: "acme/widgets",
    branch: "task",
    newTip,
  };
}

function run(cwd, command, args) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stderr}\n${result.stdout}`);
  return String(result.stdout || "").trim();
}

function commit(cwd, message) {
  run(cwd, "git", ["add", "."]);
  run(cwd, "git", ["commit", "-m", message]);
  return run(cwd, "git", ["rev-parse", "HEAD"]);
}

test("create-PR workflow cannot enter publication without ready pre-open evidence", () => {
  const current = controller();
  assert.throws(
    () => current.transition("OPEN_PR"),
    /pre_open_evidence_missing/,
  );
});

test("blocked and mismatched pre-open evidence remain publication blockers", () => {
  const current = controller();
  current.recordPreOpenGate(readyGate({ decision: "blocked" }));
  assert.throws(() => current.transition("OPEN_PR"), /pre_open_evidence_not_ready/);

  current.recordPreOpenGate(readyGate({ baseRefOid: NEXT_HEAD }));
  assert.throws(() => current.transition("OPEN_PR"), /pre_open_evidence_scope_mismatch/);

  current.recordPreOpenGate(readyGate());
  assert.equal(current.transition("OPEN_PR").phase, "OPEN_PR");
});

test("mutation boundary independently rejects missing, changed, or stale pre-open scope", () => {
  const directory = mkdtempSync(join(tmpdir(), "github-delivery-preopen-boundary-"));
  const checkpoint = join(directory, "controller.json");
  try {
    const missing = controller("OPEN_PR");
    writeDeliveryWorkflowCheckpoint(checkpoint, missing.snapshot());
    assert.throws(
      () => mutationExecutionContextFromCheckpoint({ path: checkpoint, request: pushRequest() }),
      /pre_open_evidence_missing/,
    );

    const current = controller();
    current.recordPreOpenGate(readyGate());
    current.transition("OPEN_PR");
    writeDeliveryWorkflowCheckpoint(checkpoint, current.snapshot());
    assert.deepEqual(
      mutationExecutionContextFromCheckpoint({ path: checkpoint, request: pushRequest() }),
      {
        trustedWorkflowIntent: false,
        trustedExactTextConfirmation: false,
      },
    );
    assert.throws(
      () => mutationExecutionContextFromCheckpoint({
        path: checkpoint,
        request: pushRequest(NEXT_HEAD),
      }),
      /pre_open_evidence_scope_mismatch/,
    );

    current.updateRefs({ headSha: NEXT_HEAD });
    writeDeliveryWorkflowCheckpoint(checkpoint, current.snapshot());
    assert.throws(
      () => mutationExecutionContextFromCheckpoint({
        path: checkpoint,
        request: pushRequest(NEXT_HEAD),
      }),
      /pre_open_evidence_scope_mismatch/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("completed audit operation skips before pre-open execution context", () => {
  const request = pushRequest();
  let contextCalls = 0;
  let executionCalls = 0;
  const result = executeMutationDocument({
    document: request,
    execute: true,
    dependencies: {
      completedOperationKeys: [mutationOperationKey(request)],
      authorityRuntimeEnvironment: ({ env }) => env,
      executionContextForRequest() {
        contextCalls += 1;
        throw new Error("pre-open context must not run for an already completed operation");
      },
      planMutationWithAuthority() {
        throw new Error("planning must not run for an already completed operation");
      },
      mutationAuthorityRequired() {
        throw new Error("authority checks must not run for an already completed operation");
      },
      executeMutationWithAuthority() {
        executionCalls += 1;
        throw new Error("execution must not run for an already completed operation");
      },
    },
  });

  assert.equal(result.status, "already_applied");
  assert.equal(result.outcome, "already_completed");
  assert.equal(result.skipped, true);
  assert.equal(contextCalls, 0);
  assert.equal(executionCalls, 0);
});

test("wrong historical pre-open range blocks publication until the exact candidate reruns ready", () => {
  const directory = mkdtempSync(join(tmpdir(), "github-delivery-preopen-integration-"));
  const checkpoint = join(directory, "controller.json");
  try {
    run(directory, "git", ["init"]);
    run(directory, "git", ["config", "user.email", "test@example.com"]);
    run(directory, "git", ["config", "user.name", "github-delivery test"]);
    run(directory, "git", ["remote", "add", "origin", "https://github.com/acme/widgets.git"]);

    writeFileSync(join(directory, "README.md"), "root\n", "utf8");
    const root = commit(directory, "root");

    mkdirSync(join(directory, "docs"), { recursive: true });
    writeFileSync(join(directory, "docs", "history.md"), "older dev history\n", "utf8");
    const devBase = commit(directory, "dev history");

    for (let index = 1; index <= 6; index += 1) {
      writeFileSync(join(directory, "docs", `task-${index}.md`), `task ${index}\n`, "utf8");
    }
    const taskHead = commit(directory, "task candidate");

    const profile = resolveDeliveryWorkflowProfile("create-pr-for-issue");
    const initial = createDeliveryWorkflowController({
      workflow: profile.workflow,
      repo: "acme/widgets",
      baseSha: devBase,
      headSha: taskHead,
      graph: profile.graph,
      startPhase: "PREOPEN_GATE",
    });
    writeDeliveryWorkflowCheckpoint(checkpoint, initial.snapshot());

    const wrong = spawnSync(
      process.execPath,
      [PRE_OPEN_GATE, "acme/widgets", root, taskHead, "--checkpoint", checkpoint],
      { cwd: directory, encoding: "utf8" },
    );
    assert.equal(wrong.status, 0, wrong.stderr || wrong.stdout);
    const wrongSnapshot = readDeliveryWorkflowCheckpoint(checkpoint);
    assert.equal(wrongSnapshot.preOpenGate.decision, "ready");
    assert.equal(wrongSnapshot.preOpenGate.baseSha, root);
    assert.equal(wrongSnapshot.preOpenGate.headSha, taskHead);
    assert.equal(wrongSnapshot.preOpenGate.fileCount, 7);
    assert.match(wrongSnapshot.preOpenGate.diffIdentity, /^sha256:[0-9a-f]{64}$/);
    const wrongController = createDeliveryWorkflowController({
      snapshot: wrongSnapshot,
      graph: profile.graph,
    });
    assert.throws(
      () => wrongController.transition("OPEN_PR"),
      /pre_open_evidence_scope_mismatch/,
    );

    const corrected = spawnSync(
      process.execPath,
      [PRE_OPEN_GATE, "acme/widgets", devBase, taskHead, "--checkpoint", checkpoint],
      { cwd: directory, encoding: "utf8" },
    );
    assert.equal(corrected.status, 0, corrected.stderr || corrected.stdout);
    const correctedSnapshot = readDeliveryWorkflowCheckpoint(checkpoint);
    assert.equal(correctedSnapshot.preOpenGate.decision, "ready");
    assert.equal(correctedSnapshot.preOpenGate.baseSha, devBase);
    assert.equal(correctedSnapshot.preOpenGate.headSha, taskHead);
    assert.equal(correctedSnapshot.preOpenGate.fileCount, 6);
    assert.notEqual(
      correctedSnapshot.preOpenGate.diffIdentity,
      wrongSnapshot.preOpenGate.diffIdentity,
    );

    const correctedController = createDeliveryWorkflowController({
      snapshot: correctedSnapshot,
      graph: profile.graph,
    });
    assert.equal(correctedController.transition("OPEN_PR").phase, "OPEN_PR");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
