import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  runCodexWatchdogHook,
  statePathForSession,
} from "../../scripts/codex-watchdog-hook.mjs";
import {
  createAppServerWatchdogRouter,
} from "../../scripts/lib/codex-app-server-watchdog-proxy.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const HOOK_CLI = join(ROOT, "scripts", "codex-watchdog-hook.mjs");

function runHookCli(input) {
  return spawnSync(process.execPath, [HOOK_CLI], {
    input,
    encoding: "utf8",
    timeout: 15_000,
    env: {
      ...process.env,
      GITHUB_DELIVERY_WATCHDOG_STATE_DIR: mkdtempSync(join(tmpdir(), "gd-hook-cli-")),
    },
  });
}

test("hook entrypoint persists only compact watchdog state between events", () => {
  const root = mkdtempSync(join(tmpdir(), "gd-watchdog-test-"));
  const input = {
    hook_event_name: "PreToolUse",
    session_id: "session/one",
    turn_id: "turn-1",
    tool_name: "mcp__github__fetch_file",
    tool_input: { repo: "o/r", path: "README.md", ref: "abc" },
  };

  const first = runCodexWatchdogHook(input, { stateRoot: root, now: 1_000 });
  assert.equal(first.output, null);
  const statePath = statePathForSession(root, input.session_id);
  const stored = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(stored.watchdog.stateGeneration, 0);
  assert.ok(Object.keys(stored.watchdog.reads).length === 1);
  assert.doesNotMatch(JSON.stringify(stored), /README\.md/);

  const second = runCodexWatchdogHook(input, { stateRoot: root, now: 2_000 });
  assert.equal(second.output.decision, "block");
});

test("SessionEnd removes persisted hook state", () => {
  const root = mkdtempSync(join(tmpdir(), "gd-watchdog-test-"));
  const common = { session_id: "session-two", turn_id: "turn-1" };
  runCodexWatchdogHook(
    {
      ...common,
      hook_event_name: "PreToolUse",
      tool_name: "mcp__github__fetch_file",
      tool_input: { repo: "o/r", path: "README.md", ref: "abc" },
    },
    { stateRoot: root, now: 1_000 },
  );

  const ended = runCodexWatchdogHook(
    { ...common, hook_event_name: "SessionEnd", reason: "exit" },
    { stateRoot: root },
  );
  assert.equal(ended.output, null);
  assert.equal(ended.stateRemoved, true);
});

test("app-server router forwards ordinary traffic unchanged", () => {
  const router = createAppServerWatchdogRouter();
  const message = { method: "thread/started", params: { thread: { id: "thr-1" } } };
  assert.deepEqual(router.onServerMessage(message), {
    forward: message,
    internalRequests: [],
  });
});

test("app-server router interrupts and bounds a repeated narration turn", () => {
  const router = createAppServerWatchdogRouter({ internalRequestIdPrefix: "gd-test" });
  const base = {
    method: "item/agentMessage/delta",
    params: { threadId: "thr-1", turnId: "turn-1", itemId: "item-1" },
  };

  router.onServerMessage({ ...base, params: { ...base.params, delta: "Let me read the reference.\n" } });
  router.onServerMessage({ ...base, params: { ...base.params, delta: "Let me read the reference.\n" } });
  const tripped = router.onServerMessage({
    ...base,
    params: { ...base.params, delta: "Let me read the reference.\n" },
  });

  assert.equal(tripped.internalRequests.length, 1);
  assert.equal(tripped.internalRequests[0].method, "turn/interrupt");
  assert.deepEqual(tripped.internalRequests[0].params, {
    threadId: "thr-1",
    turnId: "turn-1",
  });
  assert.match(String(tripped.internalRequests[0].id), /^gd-test-/);
});

test("proxy consumes responses to its private interrupt requests", () => {
  const router = createAppServerWatchdogRouter({ internalRequestIdPrefix: "gd-test" });
  const base = {
    method: "item/agentMessage/delta",
    params: { threadId: "thr-1", turnId: "turn-1", itemId: "item-1" },
  };
  router.onServerMessage({ ...base, params: { ...base.params, delta: "Let me read the reference.\n" } });
  router.onServerMessage({ ...base, params: { ...base.params, delta: "Let me read the reference.\n" } });
  const tripped = router.onServerMessage({
    ...base,
    params: { ...base.params, delta: "Let me read the reference.\n" },
  });
  const privateId = tripped.internalRequests[0].id;

  assert.deepEqual(router.onServerMessage({ id: privateId, result: {} }), {
    forward: null,
    internalRequests: [],
  });
});

test("invalid JSON stdin fail-closes with Codex block exit 2", () => {
  const result = runHookCli("not-json{");
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /watchdog hook error/i);
  assert.equal(result.stdout, "");
});

test("non-object JSON stdin fail-closes with Codex block exit 2", () => {
  for (const raw of ["null", "[]"]) {
    const result = runHookCli(raw);
    assert.equal(result.status, 2, `${raw}: ${result.stderr}`);
    assert.match(result.stderr, /hook input must be a JSON object/);
    assert.equal(result.stdout, "");
  }
});

test("valid PreToolUse stdin still exits 0", () => {
  const result = runHookCli(JSON.stringify({
    hook_event_name: "PreToolUse",
    session_id: "s",
    turn_id: "t",
    tool_name: "Bash",
    tool_input: { command: "echo ok" },
  }));
  assert.equal(result.status, 0, result.stderr);
});
