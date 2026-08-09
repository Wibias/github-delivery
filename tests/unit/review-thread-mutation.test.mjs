import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { isBotLogin } from "../../scripts/review-threads.mjs";
import { executeMutationRequest } from "../../scripts/lib/github-mutation-broker.mjs";
import { mutationRequiresTrustedAuthority } from "../../scripts/lib/mutation-execution-context.mjs";
import { authorizeMutation } from "../../scripts/lib/mutation-policy.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const COMMAND = join(ROOT, "scripts", "review-threads.mjs");
const HEAD = "a".repeat(40);

function snapshotWithThreads(threads) {
  const dir = mkdtempSync(join(tmpdir(), "github-delivery-review-threads-"));
  const path = join(dir, "snapshot.json");
  const snapshot = {
    schemaVersion: 1,
    kind: "github-delivery/evidence-snapshot",
    snapshotId: "test-review-thread-snapshot",
    repo: "Wibias/github-delivery",
    pr: 42,
    headOid: HEAD,
    capturedAt: new Date().toISOString(),
    complete: true,
    sources: {
      reviewThreads: {
        required: true,
        readable: true,
        complete: true,
        pages: 1,
        error: null,
      },
    },
    evidence: {
      pullRequest: {
        number: 42,
        headRefOid: HEAD,
        url: "https://github.com/Wibias/github-delivery/pull/42",
      },
      feedback: { reviewThreads: threads },
    },
  };
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  return { dir, path };
}

function unresolvedThread({
  id = "PRRT_example",
  author = "Wibias",
  resolved = false,
} = {}) {
  return {
    id,
    isResolved: resolved,
    isOutdated: false,
    path: "scripts/example.mjs",
    line: 12,
    comments: {
      nodes: [
        {
          id: "PRRC_example",
          databaseId: 77,
          body: "Please fix this.",
          createdAt: new Date().toISOString(),
          url: "https://github.com/Wibias/github-delivery/pull/42#discussion_r77",
          author: { login: author },
          authorAssociation: "MEMBER",
        },
      ],
    },
  };
}

function run(extraArgs = []) {
  return spawnSync(
    process.execPath,
    [COMMAND, "Wibias/github-delivery", "42", ...extraArgs],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, PATH: "" },
    },
  );
}

function resolveRequest(overrides = {}) {
  return {
    schemaVersion: 1,
    action: "resolve_thread",
    mutationMode: "maintainer",
    explicitInstruction: true,
    repo: "acme/widgets",
    pr: 32,
    expectedHead: "abcdef1234567890",
    threadId: "PRRT_target",
    ...overrides,
  };
}

function threadPayload({
  repo = "acme/widgets",
  pr = 32,
  head = "abcdef1234567890",
  threadId = "PRRT_target",
  isResolved = false,
  author = "coderabbitai[bot]",
} = {}) {
  return JSON.stringify({
    data: {
      node: {
        id: threadId,
        isResolved,
        repository: { nameWithOwner: repo },
        pullRequest: { number: pr, headRefOid: head },
        comments: { nodes: [{ author: { login: author } }] },
      },
    },
  });
}

test("read-only mode denies thread resolution before invoking GitHub", () => {
  const result = run(["--resolve", "PRRT_example"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /mode_denied/);
  assert.doesNotMatch(result.stderr, /ENOENT|spawn gh/i);
});

test("maintainer mode requires explicit instruction", () => {
  const result = run([
    "--resolve",
    "PRRT_example",
    "--mutation-mode",
    "maintainer",
  ]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /explicit_instruction_required/);
});

test("review mode cannot resolve human threads through --explicit", () => {
  const result = run([
    "--resolve",
    "PRRT_example",
    "--mutation-mode",
    "review",
    "--explicit",
  ]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /mode_denied/);
});

test("review mode authorizes resolve_bot_thread at policy level", () => {
  const authorization = authorizeMutation({
    mode: "review",
    action: "resolve_bot_thread",
    explicitInstruction: false,
  });
  assert.equal(authorization.allowed, true);
  assert.equal(authorization.reason, null);
});

test("resolve_bot_thread is high assurance even in review mode", () => {
  assert.equal(
    mutationRequiresTrustedAuthority({
      mutationMode: "review",
      action: "resolve_bot_thread",
    }),
    true,
  );
});

test("thread resolution plans an exact broker request without invoking gh", () => {
  const fixture = snapshotWithThreads([unresolvedThread()]);
  try {
    const result = run([
      "--snapshot",
      fixture.path,
      "--expected-head",
      HEAD,
      "--resolve",
      "PRRT_example",
      "--mutation-mode",
      "maintainer",
      "--explicit",
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /ENOENT|spawn gh/i);
    const output = JSON.parse(result.stdout);
    assert.equal(output.kind, "github-delivery/thread-resolution-plan");
    assert.equal(output.executed, false);
    assert.equal(output.expectedHead, HEAD);
    assert.equal(output.requests.length, 1);
    assert.deepEqual(output.requests[0], {
      schemaVersion: 1,
      action: "resolve_thread",
      mutationMode: "maintainer",
      explicitInstruction: true,
      repo: "Wibias/github-delivery",
      pr: 42,
      expectedHead: HEAD,
      threadId: "PRRT_example",
    });
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("bot resolution plans only exact bot-authored unresolved threads", () => {
  const fixture = snapshotWithThreads([
    unresolvedThread({ id: "PRRT_bot", author: "coderabbitai[bot]" }),
  ]);
  try {
    const result = run([
      "--snapshot",
      fixture.path,
      "--expected-head",
      HEAD,
      "--resolve-bot",
      "--mutation-mode",
      "review",
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /ENOENT|spawn gh/i);
    const output = JSON.parse(result.stdout);
    assert.equal(output.executed, false);
    assert.deepEqual(output.requests, [
      {
        schemaVersion: 1,
        action: "resolve_bot_thread",
        mutationMode: "review",
        explicitInstruction: false,
        repo: "Wibias/github-delivery",
        pr: 42,
        expectedHead: HEAD,
        threadId: "PRRT_bot",
      },
    ]);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("bot resolution refuses a snapshot that still contains unresolved human threads", () => {
  const fixture = snapshotWithThreads([
    unresolvedThread({ id: "PRRT_bot", author: "coderabbitai[bot]" }),
    unresolvedThread({ id: "PRRT_human", author: "Wibias" }),
  ]);
  try {
    const result = run([
      "--snapshot",
      fixture.path,
      "--expected-head",
      HEAD,
      "--resolve-bot",
      "--mutation-mode",
      "review",
    ]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /resolve_bot_thread_refused/);
    assert.doesNotMatch(result.stderr, /ENOENT|spawn gh/i);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("stale expected head cannot produce a resolution request", () => {
  const fixture = snapshotWithThreads([unresolvedThread()]);
  try {
    const result = run([
      "--snapshot",
      fixture.path,
      "--expected-head",
      "b".repeat(40),
      "--resolve",
      "PRRT_example",
      "--mutation-mode",
      "maintainer",
      "--explicit",
    ]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /expected_head_mismatch/);
    assert.doesNotMatch(result.stderr, /ENOENT|spawn gh/i);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("broker rejects a review thread that belongs to another PR before mutation", () => {
  const calls = [];
  assert.throws(
    () =>
      executeMutationRequest({
        request: resolveRequest(),
        execute: true,
        runner(command, args) {
          calls.push([command, ...args]);
          if (args[0] === "pr" && args[1] === "view") {
            return { status: 0, stdout: "abcdef1234567890\n", stderr: "" };
          }
          if (args[0] === "api" && args[1] === "graphql") {
            return {
              status: 0,
              stdout: threadPayload({ pr: 99 }),
              stderr: "",
            };
          }
          throw new Error(`unexpected write: ${command} ${args.join(" ")}`);
        },
      }),
    /review_thread_target_mismatch:pr/,
  );
  assert.equal(
    calls.some((call) => call.some((arg) => String(arg).includes("resolveReviewThread"))),
    false,
  );
});

test("broker refuses resolve_bot_thread when the target is human-authored", () => {
  const calls = [];
  assert.throws(
    () =>
      executeMutationRequest({
        request: resolveRequest({
          action: "resolve_bot_thread",
          mutationMode: "review",
          explicitInstruction: false,
        }),
        execute: true,
        runner(command, args) {
          calls.push([command, ...args]);
          if (args[0] === "pr" && args[1] === "view") {
            return { status: 0, stdout: "abcdef1234567890\n", stderr: "" };
          }
          if (args[0] === "api" && args[1] === "graphql") {
            return {
              status: 0,
              stdout: threadPayload({ author: "human-reviewer" }),
              stderr: "",
            };
          }
          throw new Error(`unexpected write: ${command} ${args.join(" ")}`);
        },
      }),
    /resolve_bot_thread_target_not_bot/,
  );
  assert.equal(
    calls.some((call) => call.some((arg) => String(arg).includes("resolveReviewThread"))),
    false,
  );
});

test("already-resolved thread returns already_applied without mutation", () => {
  const calls = [];
  const result = executeMutationRequest({
    request: resolveRequest(),
    execute: true,
    runner(command, args) {
      calls.push([command, ...args]);
      if (args[0] === "pr" && args[1] === "view") {
        return { status: 0, stdout: "abcdef1234567890\n", stderr: "" };
      }
      if (args[0] === "api" && args[1] === "graphql") {
        return {
          status: 0,
          stdout: threadPayload({ isResolved: true }),
          stderr: "",
        };
      }
      throw new Error(`unexpected write: ${command} ${args.join(" ")}`);
    },
  });
  assert.equal(result.status, "already_applied");
  assert.equal(result.executed, false);
  assert.equal(result.threadTarget.threadId, "PRRT_target");
  assert.equal(
    calls.some((call) => call.some((arg) => String(arg).includes("resolveReviewThread"))),
    false,
  );
});

test("successful thread resolution verifies the same exact thread postcondition", () => {
  const calls = [];
  let threadReads = 0;
  const result = executeMutationRequest({
    request: resolveRequest(),
    execute: true,
    runner(command, args) {
      calls.push([command, ...args]);
      if (args[0] === "pr" && args[1] === "view") {
        return { status: 0, stdout: "abcdef1234567890\n", stderr: "" };
      }
      if (args[0] === "api" && args[1] === "graphql") {
        const queryArg = args.find((arg) => String(arg).startsWith("query=")) || "";
        if (queryArg.includes("resolveReviewThread")) {
          return {
            status: 0,
            stdout: JSON.stringify({
              data: { resolveReviewThread: { thread: { id: "PRRT_target", isResolved: true } } },
            }),
            stderr: "",
          };
        }
        threadReads += 1;
        return {
          status: 0,
          stdout: threadPayload({ isResolved: threadReads > 1 }),
          stderr: "",
        };
      }
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    },
  });
  assert.equal(result.status, "succeeded");
  assert.equal(result.threadTarget.threadId, "PRRT_target");
  assert.equal(result.verification.threadId, "PRRT_target");
  assert.equal(result.verification.isResolved, true);
  assert.equal(threadReads, 2);
  assert.equal(
    calls.filter((call) => call.some((arg) => String(arg).includes("resolveReviewThread"))).length,
    1,
  );
});

test("isBotLogin recognizes bot logins and rejects humans", () => {
  assert.equal(isBotLogin("coderabbitai[bot]"), true);
  assert.equal(isBotLogin("chatgpt-codex-connector[bot]"), true);
  assert.equal(isBotLogin("github-actions[bot]"), true);
  assert.equal(isBotLogin("some-agent[bot]"), true);
  assert.equal(isBotLogin("DevMello"), false);
  assert.equal(isBotLogin("Wibias"), false);
  assert.equal(isBotLogin(null), false);
  assert.equal(isBotLogin(""), false);
});

test("read-only mode is rejected for the full-review workflow", () => {
  const result = run([
    "--resolve",
    "PRRT_example",
    "--workflow",
    "references/full-review-pr.md",
    "--mutation-mode",
    "read-only",
  ]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /mode_denied_by_workflow/);
  assert.doesNotMatch(result.stderr, /ENOENT|spawn gh/i);
});
