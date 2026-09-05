#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import { createAppServerWatchdogRouter } from "./lib/codex-app-server-watchdog-proxy.mjs";
import { createCodexDebugTraceRecorder } from "./lib/codex-debug-trace.mjs";
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

function disabledDebugTraceRecorder() {
  return {
    enabled: false,
    path: null,
    record() {},
    close() {},
  };
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

function sanitizedInheritedEnv(env, platformName) {
  const runtimeEnv = { ...env };
  if (platformName === "win32") {
    // PowerShell 7 can export a PSModulePath that prevents a descendant Windows
    // PowerShell process from finding inbox modules such as Get-FileHash. Codex's
    // Windows self-updater can launch powershell.exe, so let that shell rebuild
    // its native module path instead of inheriting a path for a different host.
    for (const key of Object.keys(runtimeEnv)) {
      if (key.toLowerCase() === "psmodulepath") delete runtimeEnv[key];
    }
  }
  return runtimeEnv;
}

export function protectedRuntimeEnv(env = process.env, platformName = process.platform) {
  return {
    ...sanitizedInheritedEnv(env, platformName),
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
  bridgeStarter = startCodexWatchdogRemoteBridge,
  stderr = process.stderr,
  debugTraceStateDir = null,
  debugTraceRecorder = null,
} = {}) {
  validateProtectedClientArgs(args);

  let trace = debugTraceRecorder;
  if (!trace) {
    try {
      trace = createCodexDebugTraceRecorder({ env, stateDir: debugTraceStateDir });
    } catch (error) {
      trace = disabledDebugTraceRecorder();
      stderr.write(
        `github-delivery debug trace unavailable: ${error?.message || error}\n`,
      );
    }
  }
  let traceClosed = false;
  const closeTrace = () => {
    if (traceClosed) return;
    traceClosed = true;
    try {
      trace.close();
    } catch {
      // Debug tracing is optional diagnostics and must not change launcher behavior.
    }
  };

  const token = randomBytes(32).toString("base64url");
  const runtimeEnv = protectedRuntimeEnv(env);
  const appServer = spawnImpl(codexBin, ["app-server"], {
    stdio: ["pipe", "pipe", "inherit"],
    windowsHide: true,
    env: runtimeEnv,
  });
  try {
    await waitForSpawn(appServer);
  } catch (error) {
    closeTrace();
    throw error;
  }

  const router = createAppServerWatchdogRouter({
    onDebugTrace: trace.enabled ? (event) => trace.record(event) : undefined,
  });
  let bridge;
  try {
    bridge = await bridgeStarter({
      appServerInput: appServer.stdin,
      appServerOutput: appServer.stdout,
      token,
      router,
    });
  } catch (error) {
    if (!appServer.killed) appServer.kill();
    closeTrace();
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
    closeTrace();
    throw error;
  }

  const cleanup = async () => {
    if (client && !client.killed) client.kill();
    if (!appServer.killed) appServer.kill();
    await bridge.close().catch(() => {});
    closeTrace();
  };
  const signals = ["SIGINT", "SIGTERM"];
  const handlers = new Map();
  for (const signal of signals) {
    const handler = () => void cleanup();
    handlers.set(signal, handler);
    process.once(signal, handler);
  }

  const bridgeFailure = bridge.failure
    ? bridge.failure.then((failure) => {
        const code = failure?.code || "unknown_watchdog_failure";
        const message = failure?.message || "protected stream enforcement failed";
        throw new Error(`watchdog enforcement failed (${code}): ${message}`);
      })
    : new Promise(() => {});

  try {
    return await Promise.race([waitForExit(client), bridgeFailure]);
  } finally {
    await cleanup();
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
