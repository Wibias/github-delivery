#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import { startCodexWatchdogRemoteBridge } from "./lib/codex-watchdog-remote-bridge.mjs";

const TOKEN_ENV = "GITHUB_DELIVERY_CODEX_REMOTE_TOKEN";

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

export function protectedClientArgs(args, url) {
  if (args.some((arg) => arg === "--remote" || arg.startsWith("--remote="))) {
    throw new Error("protected Codex launcher owns --remote; remove the caller-supplied remote endpoint");
  }
  if (args.some((arg) => arg === "--remote-auth-token-env" || arg.startsWith("--remote-auth-token-env="))) {
    throw new Error("protected Codex launcher owns --remote-auth-token-env");
  }
  return ["--remote", url, "--remote-auth-token-env", TOKEN_ENV, ...args];
}

export async function runProtectedCodex({
  codexBin = process.env.CODEX_BIN || "codex",
  args = process.argv.slice(2),
  env = process.env,
  spawnImpl = spawn,
  stderr = process.stderr,
} = {}) {
  const token = randomBytes(32).toString("base64url");
  const appServer = spawnImpl(codexBin, ["app-server"], {
    stdio: ["pipe", "pipe", "inherit"],
    windowsHide: true,
    env,
  });
  appServer.once("error", (error) => {
    stderr.write(`github-delivery watchdog app-server error: ${error?.message || error}\n`);
  });

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

  const clientEnv = { ...env, [TOKEN_ENV]: token };
  const client = spawnImpl(codexBin, protectedClientArgs(args, bridge.url), {
    stdio: "inherit",
    windowsHide: true,
    env: clientEnv,
  });

  const cleanup = async () => {
    if (!client.killed) client.kill();
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
    const outcome = await waitForExit(client);
    if (!appServer.killed) appServer.kill();
    await bridge.close();
    return outcome;
  } finally {
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
