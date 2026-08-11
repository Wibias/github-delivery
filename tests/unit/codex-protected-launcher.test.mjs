import assert from "node:assert/strict";
import test from "node:test";

import {
  protectedClientArgs,
  protectedRuntimeEnv,
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
