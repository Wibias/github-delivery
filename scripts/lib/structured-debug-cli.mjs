import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import { createAgentDebugTraceRecorder } from "./agent-debug-trace.mjs";

function disabledRecorder() {
  return {
    enabled: false,
    path: null,
    record() {},
    close() {},
  };
}

export function runStructuredDebugCli({
  provider,
  bin,
  args,
  env = process.env,
  stateDir = null,
  normalize,
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
  spawnImpl = spawn,
} = {}) {
  if (typeof normalize !== "function") throw new Error("structured debug CLI normalizer is required");

  let recorder;
  try {
    recorder = createAgentDebugTraceRecorder({ provider, env, stateDir });
  } catch (error) {
    recorder = disabledRecorder();
    stderr.write(`github-delivery ${provider} debug trace unavailable: ${error?.message || error}\n`);
  }

  const child = spawnImpl(bin, args, {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env,
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let closed = false;

  function closeRecorder() {
    if (closed) return;
    closed = true;
    try {
      recorder.close();
    } catch {
      // Debug tracing is diagnostic-only and cannot change the wrapped CLI result.
    }
  }

  lines.on("line", (line) => {
    stdout.write(`${line}\n`);
    if (!recorder.enabled) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const event = normalize(message);
    if (!event) return;
    try {
      recorder.record(event);
    } catch {
      // An individual trace write must never change the wrapped CLI execution.
    }
  });

  child.stderr.on("data", (chunk) => stderr.write(chunk));
  child.on("error", (error) => {
    closeRecorder();
    stderr.write(`github-delivery ${provider} debug wrapper error: ${error?.message || error}\n`);
  });
  child.on("exit", (code, signal) => {
    closeRecorder();
    lines.close();
    if (signal) {
      stderr.write(`github-delivery ${provider} debug wrapper: process exited on ${signal}\n`);
      process.exitCode = 1;
    } else if (Number.isInteger(code)) {
      process.exitCode = code;
    }
  });

  if (stdin?.readable && child.stdin?.writable) {
    stdin.pipe(child.stdin);
  } else {
    child.stdin?.end();
  }

  return { child, recorder };
}
