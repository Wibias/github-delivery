import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  runCodexWatchdogHook,
  statePathForSession,
} from "../../scripts/codex-watchdog-hook.mjs";
import { sessionStateDirectory } from "../../scripts/lib/watchdog-state-store.mjs";

const hookEntrypoint = fileURLToPath(new URL("../../scripts/codex-watchdog-hook.mjs", import.meta.url));

function readInput({ sessionId, turnId, agentId = undefined, path }) {
  return {
    hook_event_name: "PreToolUse",
    session_id: sessionId,
    turn_id: turnId,
    ...(agentId ? { agent_id: agentId } : {}),
    tool_name: "mcp__github__fetch_file",
    tool_input: { repo: "o/r", path, ref: "abc" },
  };
}

function runHookProcess(input, stateRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hookEntrypoint], {
      env: { ...process.env, GITHUB_DELIVERY_WATCHDOG_STATE_DIR: stateRoot },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(`${JSON.stringify(input)}\n`);
  });
}

test("hook persistence isolates agents inside the same session and turn", () => {
  const root = mkdtempSync(join(tmpdir(), "gd-agent-isolation-"));
  const common = { sessionId: "session-agent", turnId: "turn-agent", path: "README.md" };

  const agentA = runCodexWatchdogHook(readInput({ ...common, agentId: "agent-a" }), {
    stateRoot: root,
    now: 1_000,
  });
  const agentB = runCodexWatchdogHook(readInput({ ...common, agentId: "agent-b" }), {
    stateRoot: root,
    now: 2_000,
  });

  assert.equal(agentA.output, null);
  assert.equal(agentB.output, null);
  assert.notEqual(agentA.statePath, agentB.statePath);
});

test("concurrent hook processes do not lose evidence increments", async () => {
  const root = mkdtempSync(join(tmpdir(), "gd-concurrent-state-"));
  const sessionId = "session-concurrent";
  const turnId = "turn-concurrent";
  const count = 6;

  const results = await Promise.all(
    Array.from({ length: count }, (_, index) =>
      runHookProcess(
        readInput({
          sessionId,
          turnId,
          path: `src/concurrent-${index}.mjs`,
        }),
        root,
      ),
    ),
  );

  for (const result of results) {
    assert.equal(result.code, 0, result.stderr || result.stdout);
  }

  const statePath = statePathForSession(root, sessionId, turnId);
  const stored = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(stored.watchdog.totalEvidenceAttempts, count);
  assert.equal(stored.watchdog.consecutiveEvidenceAttempts, count);
  assert.equal(Object.keys(stored.watchdog.reads).length, count);
  assert.doesNotMatch(JSON.stringify(stored), /concurrent-\d+\.mjs/);
});

test("fresh locks are respected and stale locks recover", () => {
  const root = mkdtempSync(join(tmpdir(), "gd-lock-state-"));
  const input = readInput({
    sessionId: "session-lock",
    turnId: "turn-lock",
    path: "README.md",
  });
  const statePath = statePathForSession(root, input.session_id, input.turn_id);
  mkdirSync(dirname(statePath), { recursive: true });
  const lockPath = `${statePath}.lock`;
  writeFileSync(lockPath, "", "utf8");

  assert.throws(
    () => runCodexWatchdogHook(input, {
      stateRoot: root,
      now: 1_000,
      lockWaitMs: 20,
      staleLockMs: 10_000,
    }),
    /Timed out acquiring watchdog state lock/,
  );

  const old = new Date(Date.now() - 60_000);
  utimesSync(lockPath, old, old);
  const recovered = runCodexWatchdogHook(input, {
    stateRoot: root,
    now: 2_000,
    lockWaitMs: 100,
    staleLockMs: 1_000,
  });
  assert.equal(recovered.output, null);
  assert.equal(existsSync(lockPath), false);
});

test("malformed persisted state fails explicitly instead of silently disabling protection", () => {
  const root = mkdtempSync(join(tmpdir(), "gd-malformed-state-"));
  const input = readInput({
    sessionId: "session-malformed",
    turnId: "turn-malformed",
    path: "README.md",
  });
  const statePath = statePathForSession(root, input.session_id, input.turn_id);
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, "{not-json", "utf8");

  assert.throws(
    () => runCodexWatchdogHook(input, { stateRoot: root, now: 1_000 }),
    /Malformed watchdog state/,
  );
});

test("symlinked state roots and state files fail closed on POSIX", () => {
  if (process.platform === "win32") return;
  const parent = mkdtempSync(join(tmpdir(), "gd-symlink-state-"));
  const targetRoot = join(parent, "target-root");
  const linkedRoot = join(parent, "linked-root");
  mkdirSync(targetRoot, { mode: 0o700 });
  symlinkSync(targetRoot, linkedRoot, "dir");
  const input = readInput({
    sessionId: "session-symlink",
    turnId: "turn-symlink",
    path: "README.md",
  });

  assert.throws(
    () => runCodexWatchdogHook(input, { stateRoot: linkedRoot, now: 1_000 }),
    /symlink/i,
  );

  const safeRoot = mkdtempSync(join(tmpdir(), "gd-symlink-file-"));
  const statePath = statePathForSession(safeRoot, input.session_id, input.turn_id);
  mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 });
  const targetFile = join(parent, "outside-state.json");
  writeFileSync(targetFile, "{}\n", "utf8");
  symlinkSync(targetFile, statePath, "file");

  assert.throws(
    () => runCodexWatchdogHook(input, { stateRoot: safeRoot, now: 2_000 }),
    /symlink/i,
  );
});

test("SessionEnd removes every turn and agent state under the hashed session directory", () => {
  const root = mkdtempSync(join(tmpdir(), "gd-session-cleanup-"));
  const sessionId = "session-cleanup";
  runCodexWatchdogHook(
    readInput({ sessionId, turnId: "turn-a", agentId: "agent-a", path: "a" }),
    { stateRoot: root, now: 1_000 },
  );
  runCodexWatchdogHook(
    readInput({ sessionId, turnId: "turn-b", agentId: "agent-b", path: "b" }),
    { stateRoot: root, now: 2_000 },
  );
  const sessionDirectory = sessionStateDirectory(root, sessionId);
  assert.equal(existsSync(sessionDirectory), true);

  const ended = runCodexWatchdogHook(
    { hook_event_name: "SessionEnd", session_id: sessionId },
    { stateRoot: root },
  );
  assert.equal(ended.stateRemoved, true);
  assert.equal(existsSync(sessionDirectory), false);
});

test("persisted state files are private on POSIX platforms", () => {
  if (process.platform === "win32") return;
  const root = mkdtempSync(join(tmpdir(), "gd-state-mode-"));
  const result = runCodexWatchdogHook(
    readInput({ sessionId: "session-mode", turnId: "turn-mode", path: "README.md" }),
    { stateRoot: root, now: 1_000 },
  );
  const mode = statSync(result.statePath).mode & 0o777;
  assert.equal(mode & 0o077, 0);
});
