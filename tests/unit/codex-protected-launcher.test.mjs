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
