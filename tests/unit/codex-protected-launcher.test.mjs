import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  protectedClientArgs,
  protectedRuntimeEnv,
  runProtectedCodex,
} from "../../scripts/codex-with-watchdog.mjs";

test("protected launcher owns the remote endpoint and preserves normal Codex args", () => {
  assert.deepEqual(protectedClientArgs(["resume", "abc"], "ws://127.0.0.1:4500"), [
    "--remote",
    "ws://127.0.0.1:4500",
    "--remote-auth-token-env",
    "GITHUB_DELIVERY_CODEX_REMOTE_TOKEN",
    "resume",
    "abc",
  ]);
});

test("protected launcher rejects caller attempts to bypass its remote bridge", () => {
  assert.throws(
    () => protectedClientArgs(["--remote", "ws://elsewhere:4500"], "ws://127.0.0.1:4500"),
    /owns --remote/,
  );
  assert.throws(
    () => protectedClientArgs(["--remote-auth-token-env=OTHER"], "ws://127.0.0.1:4500"),
    /owns --remote-auth-token-env/,
  );
});

test("protected launcher declares stream capability only inside its launched runtime", () => {
  const env = protectedRuntimeEnv({ EXISTING: "keep" });
  assert.equal(env.EXISTING, "keep");
  assert.equal(env.SHIPPING_GITHUB_HOST, "codex");
  assert.equal(env.SHIPPING_GITHUB_PROGRESS_WATCHDOG, "stream");
  assert.equal(env.SHIPPING_GITHUB_STREAM_LAUNCH_CONTROLLED, "true");
});

test("protected launcher removes inherited PowerShell module paths on Windows", () => {
  const env = protectedRuntimeEnv(
    {
      EXISTING: "keep",
      PsMoDuLePaTh: "C:\\Program Files\\PowerShell\\7\\Modules",
    },
    "win32",
  );

  assert.equal(env.EXISTING, "keep");
  assert.equal(Object.keys(env).some((key) => key.toLowerCase() === "psmodulepath"), false);
});

test("protected launcher preserves PowerShell module paths outside Windows", () => {
  const env = protectedRuntimeEnv({ PSModulePath: "/opt/powershell/modules" }, "linux");
  assert.equal(env.PSModulePath, "/opt/powershell/modules");
});

function fakeChild({ piped = false } = {}) {
  const child = new EventEmitter();
  child.killed = false;
  child.stdin = piped ? new PassThrough() : null;
  child.stdout = piped ? new PassThrough() : null;
  child.kill = () => {
    child.killed = true;
    return true;
  };
  return child;
}

test("protected launcher kills the process tree when bridge enforcement fails", async () => {
  const appServer = fakeChild({ piped: true });
  const client = fakeChild();
  const spawned = [appServer, client];
  const spawnImpl = () => {
    const child = spawned.shift();
    queueMicrotask(() => child.emit("spawn"));
    return child;
  };
  let bridgeClosed = false;
  const bridgeStarter = async () => ({
    url: "ws://127.0.0.1:4500",
    failure: Promise.resolve({
      code: "interrupt_rejected",
      message: "turn interrupt was rejected",
    }),
    close: async () => {
      bridgeClosed = true;
    },
  });

  await assert.rejects(
    runProtectedCodex({
      args: [],
      env: {},
      spawnImpl,
      bridgeStarter,
      stderr: { write() {} },
    }),
    /watchdog enforcement failed.*interrupt_rejected/i,
  );

  assert.equal(appServer.killed, true);
  assert.equal(client.killed, true);
  assert.equal(bridgeClosed, true);
});

test("protected launcher routes stream summaries into the opt-in debug recorder", async () => {
  const appServer = fakeChild({ piped: true });
  const client = fakeChild();
  const spawned = [appServer, client];
  const spawnImpl = () => {
    const child = spawned.shift();
    queueMicrotask(() => {
      child.emit("spawn");
      if (child === client) queueMicrotask(() => child.emit("exit", 0, null));
    });
    return child;
  };

  const recorded = [];
  let recorderClosed = false;
  const debugTraceRecorder = {
    enabled: true,
    record: (event) => recorded.push(event),
    close: () => {
      recorderClosed = true;
    },
  };
  const bridgeStarter = async ({ router }) => {
    router.onServerMessage({
      method: "item/reasoning/summaryTextDelta",
      params: {
        threadId: "thr-protected",
        turnId: "turn-protected",
        itemId: "reasoning-protected",
        delta: "Visible protected-stream summary",
      },
    });
    return {
      url: "ws://127.0.0.1:4500",
      failure: new Promise(() => {}),
      close: async () => {},
    };
  };

  const result = await runProtectedCodex({
    args: [],
    env: {},
    spawnImpl,
    bridgeStarter,
    stderr: { write() {} },
    debugTraceRecorder,
  });

  assert.deepEqual(result, { code: 0, signal: null });
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].type, "reasoning_summary_delta");
  assert.equal(recorded[0].text, "Visible protected-stream summary");
  assert.equal(recorderClosed, true);
});
