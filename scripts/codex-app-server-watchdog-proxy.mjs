#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

import { createAppServerWatchdogRouter } from "./lib/codex-app-server-watchdog-proxy.mjs";
import { createCodexDebugTraceRecorder } from "./lib/codex-debug-trace.mjs";

function disabledDebugTraceRecorder() {
  return {
    enabled: false,
    path: null,
    record() {},
    close() {},
  };
}

export function runProxy({
  codexBin = process.env.CODEX_BIN || "codex",
  args = process.argv.slice(2),
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
  spawnImpl = spawn,
  debugTraceEnv = process.env,
  debugTraceStateDir = null,
  debugTraceRecorder = null,
} = {}) {
  const child = spawnImpl(codexBin, ["app-server", ...args], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  let trace = debugTraceRecorder;
  if (!trace) {
    try {
      trace = createCodexDebugTraceRecorder({
        env: debugTraceEnv,
        stateDir: debugTraceStateDir,
      });
    } catch (error) {
      trace = disabledDebugTraceRecorder();
      stderr.write(
        `github-delivery debug trace unavailable: ${error?.message || error}\n`,
      );
    }
  }

  const router = createAppServerWatchdogRouter({
    onDebugTrace: trace.enabled ? (event) => trace.record(event) : undefined,
  });
  const clientLines = createInterface({ input: stdin, crlfDelay: Infinity });
  const serverLines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let traceClosed = false;

  function closeTrace() {
    if (traceClosed) return;
    traceClosed = true;
    try {
      trace.close();
    } catch {
      // Debug tracing is optional diagnostics and must not change proxy behavior.
    }
  }

  clientLines.on("line", (line) => {
    if (child.stdin.writable) child.stdin.write(`${line}\n`);
  });
  stdin.on("end", () => child.stdin.end());

  serverLines.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      stdout.write(`${line}\n`);
      return;
    }

    const routed = router.onServerMessage(message);
    if (routed.forward) stdout.write(`${JSON.stringify(routed.forward)}\n`);
    for (const request of routed.internalRequests) {
      if (child.stdin.writable) child.stdin.write(`${JSON.stringify(request)}\n`);
      stderr.write(
        `github-delivery watchdog: interrupted no-progress Codex turn ${request.params.turnId}\n`,
      );
    }
  });

  child.stderr.on("data", (chunk) => stderr.write(chunk));
  child.on("error", (error) => {
    closeTrace();
    stderr.write(`github-delivery watchdog proxy error: ${error?.message || error}\n`);
  });
  child.on("exit", (code, signal) => {
    closeTrace();
    clientLines.close();
    serverLines.close();
    if (signal) {
      stderr.write(`github-delivery watchdog proxy: codex exited on ${signal}\n`);
      process.exitCode = 1;
    } else if (Number.isInteger(code)) {
      process.exitCode = code;
    }
  });

  return child;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runProxy();
