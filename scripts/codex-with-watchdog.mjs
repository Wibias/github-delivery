#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import { startCodexWatchdogRemoteBridge } from "./lib/codex-watchdog-remote-bridge.mjs";

const TOKEN_ENV = "GITHUB_DELIVERY_CODEX_REMOTE_TOKEN";

function waitForSpawn(child) {
  return new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

export function validateProtectedClientArgs(args) {
  if (args.some((arg) => arg === "--remote" || arg.startsWith("--remote="))) {
    throw new Error("protected Codex launcher owns --remote; remove the caller-supplied remote endpoint");
  }
  if (args.some((arg) => arg === "--remote-auth-token-env" || arg.startsWith("--remote-auth-token-env="))) {
    throw new Error("protected Codex launcher owns --remote-auth-token-env");
  }
}

export function protectedClientArgs(args, url) {
  validateProtectedClientArgs(args);
  return ["--remote", url, "--remote-auth-token-env", TOKEN_ENV, ...args];
}

export function protectedRuntimeEnv(env = process.env) {
  return {
    ...env,
    SHIPPING_GITHUB_HOST: "codex",
    SHIPPING_GITHUB_PROGRESS_WATCHDOG: "stream",
    SHIPPING_GITHUB_STREAM_LAUNCH_CONTROLLED: "true",
  };
}

export async function runProtectedCodex({
  codexBin = process.env.CODEX_BIN || "codex",
  args = process.argv.slice(2),
  env = process.env,
  spawnImpl = spawn,
  stderr = process.stderr,
} = {}) {
  validateProtectedClientArgs(args);
  const token = randomBytes(32).toString("base64url");
  const runtimeEnv = protectedRuntimeEnv(env);
  const appServer = spawnImpl(codexBin, ["app-server"], {
    stdio: ["pipe", "pipe", "inherit"],
    windowsHide: true,
    env: runtimeEnv,
  });
  await waitForSpawn(appServer);

  let bridge;
  try {
    bridge = await startCodexWatchdogRemoteBridge({
      appServerInput: appServer.stdin,
      appServerOutput: appServer.stdout,
      token,
    });
  } catch (error) {
    if (!appServer.killed) appServer.kill();
    throw error;
  }

  const clientEnv = { ...runtimeEnv, [TOKEN_ENV]: token };
  let client;
  try {
    client = spawnImpl(codexBin, protectedClientArgs(args, bridge.url), {
      stdio: "inherit",
      windowsHide: true,
      env: clientEnv,
    });
    await waitForSpawn(client);
  } catch (error) {
    if (client && !client.killed) client.kill();
    if (!appServer.killed) appServer.kill();
    await bridge.close().catch(() => {});
    throw error;
  }

  const cleanup = async () => {
    if (client && !client.killed) client.kill();
    if (!appServer.killed) appServer.kill();
    await bridge.close().catch(() => {});
  };
  const signals = ["SIGINT", "SIGTERM"];
  const handlers = new Map();
  for (const signal of signals) {
    const handler = () => void cleanup();
    handlers.set(signal, handler);
    process.once(signal, handler);
  }

  try {
    return await waitForExit(client);
  } finally {
    if (!appServer.killed) appServer.kill();
    await bridge.close().catch(() => {});
    for (const [signal, handler] of handlers) process.off(signal, handler);
  }
}

export async function main() {
  try {
    const result = await runProtectedCodex();
    if (result.signal) {
      process.stderr.write(`github-delivery protected Codex exited on ${result.signal}\n`);
      process.exitCode = 1;
    } else {
      process.exitCode = Number.isInteger(result.code) ? result.code : 1;
    }
  } catch (error) {
    process.stderr.write(`github-delivery protected Codex failed: ${error?.message || error}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
