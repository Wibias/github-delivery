import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  createDeliveryWorkflowController,
  writeDeliveryWorkflowCheckpoint,
} from "../../scripts/lib/delivery-workflow-controller.mjs";
import * as mutationCheckpoint from "../../scripts/lib/mutation-checkpoint.mjs";
import {
  executeMutationDocument,
  mutationOperationKey,
} from "../../scripts/lib/mutation-document-execution.mjs";
import { boundedSpawnSync } from "../../scripts/lib/subprocess-policy.mjs";

const SHA_A = "a".repeat(40);

function request(action, extra = {}) {
  return {
    schemaVersion: 1,
    action,
    mutationMode: "maintainer",
    explicitInstruction: true,
    repo: "acme/widgets",
    ...extra,
  };
}

test("Windows protected subprocesses never resolve gh or git from the current worktree", () => {
  const spawned = [];
  const present = new Set([
    "C:\\repo\\.git",
    "C:\\repo\\gh.exe",
    "C:\\repo\\git.exe",
    "C:\\Tools\\GitHub CLI\\gh.exe",
    "C:\\Program Files\\Git\\cmd\\git.exe",
  ]);
  const dependencies = {
    platform: "win32",
    cwd: "C:\\repo",
    env: {
      PATH: "C:\\repo;C:\\Tools\\GitHub CLI;C:\\Program Files\\Git\\cmd",
    },
    exists(path) {
      return present.has(path);
    },
    canonicalizePath(path) {
      return path;
    },
    spawn(command, argv, options) {
      spawned.push({ command, argv, options });
      return { status: 0, stdout: "", stderr: "" };
    },
  };

  boundedSpawnSync("gh", ["--version"], { encoding: "utf8" }, dependencies);
  boundedSpawnSync("git", ["--version"], { encoding: "utf8" }, dependencies);

  assert.equal(spawned.length, 2);
  assert.equal(spawned[0].command, "C:\\Tools\\GitHub CLI\\gh.exe");
  assert.equal(spawned[1].command, "C:\\Program Files\\Git\\cmd\\git.exe");
  assert.deepEqual(spawned[0].argv, ["--version"]);
  assert.deepEqual(spawned[1].argv, ["--version"]);
});

test("mutation documents propagate governing workflow context to planning and execution", () => {
  const contexts = [];
  const operation = request("create_issue", {
    title: "Boundary regression",
    body: "body",
    idempotencyKey: "boundary-regression",
  });

  const output = executeMutationDocument({
    document: operation,
    execute: true,
    dependencies: {
      executionContextForRequest() {
        return {
          trustedWorkflowIntent: true,
          trustedExactTextConfirmation: false,
        };
      },
      planMutationWithAuthority(_request, options) {
        contexts.push(["plan", options]);
        return { kind: "validated" };
      },
      mutationAuthorityRequired: () => false,
      executeMutationWithAuthority(options) {
        contexts.push(["execute", options]);
        return {
          action: options.request.action,
          request: options.request,
          status: "succeeded",
        };
      },
    },
  });

  assert.equal(contexts[0][1].trustedWorkflowIntent, true);
  assert.equal(contexts[1][1].trustedWorkflowIntent, true);
  assert.equal(output.status, "succeeded");
});

test("workflow mutation context is bound to one exact operation key", () => {
  const controller = createDeliveryWorkflowController({
    workflow: "create-pr-from-local-work",
    repo: "acme/widgets",
    startPhase: "ROUTE",
    graph: { ROUTE: ["DONE"], DONE: [] },
    headSha: SHA_A,
  });
  assert.equal(typeof controller.authorizeMutation, "function");

  const approved = request("create_issue", {
    title: "Approved",
    body: "body",
    idempotencyKey: "context-scope",
  });
  const changed = { ...approved, title: "Different effect" };
  controller.authorizeMutation({
    operationKey: mutationOperationKey(approved),
    trustedWorkflowIntent: true,
  });

  const directory = mkdtempSync(join(tmpdir(), "github-delivery-context-"));
  const checkpoint = join(directory, "controller.json");
  try {
    writeDeliveryWorkflowCheckpoint(checkpoint, controller.snapshot());
    assert.equal(
      typeof mutationCheckpoint.mutationExecutionContextFromCheckpoint,
      "function",
    );
    assert.deepEqual(
      mutationCheckpoint.mutationExecutionContextFromCheckpoint({
        path: checkpoint,
        request: approved,
      }),
      {
        trustedWorkflowIntent: true,
        trustedExactTextConfirmation: false,
      },
    );
    assert.deepEqual(
      mutationCheckpoint.mutationExecutionContextFromCheckpoint({
        path: checkpoint,
        request: changed,
      }),
      {
        trustedWorkflowIntent: false,
        trustedExactTextConfirmation: false,
      },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("canonical github-mutate consumes checkpoint intent in authority off mode", () => {
  const incomplete = request("create_issue", {
    idempotencyKey: "off-mode-cli-context",
  });
  const controller = createDeliveryWorkflowController({
    workflow: "create-pr-from-local-work",
    repo: "acme/widgets",
    startPhase: "ROUTE",
    graph: { ROUTE: ["DONE"], DONE: [] },
  });
  controller.authorizeMutation({
    operationKey: mutationOperationKey(incomplete),
    trustedWorkflowIntent: true,
  });

  const directory = mkdtempSync(join(tmpdir(), "github-delivery-off-mode-cli-"));
  const checkpoint = join(directory, "controller.json");
  const requestPath = join(directory, "request.json");
  try {
    writeDeliveryWorkflowCheckpoint(checkpoint, controller.snapshot());
    writeFileSync(requestPath, `${JSON.stringify(incomplete)}\n`, "utf8");
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../../scripts/github-mutate.mjs", import.meta.url)),
        "--request",
        requestPath,
        "--checkpoint",
        checkpoint,
        "--execute",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_DELIVERY_AUTHORITY_MODE: "off",
        },
      },
    );
    assert.equal(result.status, 2);
    assert.doesNotMatch(String(result.stderr || ""), /explicit_instruction_required/);
    assert.match(String(result.stderr || ""), /title_required/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("shared idempotency labels cannot collapse different mutation payloads", () => {
  const first = request("post_comment", {
    pr: 41,
    expectedHead: SHA_A,
    idempotencyKey: "shared-label",
    body: "first",
  });
  const second = request("post_comment", {
    pr: 42,
    expectedHead: SHA_A,
    idempotencyKey: "shared-label",
    body: "second",
  });

  assert.notEqual(mutationOperationKey(first), mutationOperationKey(second));

  const executed = [];
  const output = executeMutationDocument({
    document: [first, second],
    execute: false,
    dependencies: {
      mutationAuthorityRequired: () => false,
      executeMutationWithAuthority({ request: current }) {
        executed.push(current.pr);
        return {
          action: current.action,
          request: current,
          status: "succeeded",
        };
      },
    },
  });

  assert.deepEqual(executed, [41, 42]);
  assert.equal(output.results[0].status, "succeeded");
  assert.equal(output.results[1].status, "succeeded");
  assert.notEqual(output.results[0].operationKey, output.results[1].operationKey);
});
