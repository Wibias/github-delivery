import { spawnSync } from "node:child_process";

export const DEFAULT_SUBPROCESS_TIMEOUT_MS = 120_000;
export const DEFAULT_SUBPROCESS_KILL_SIGNAL = "SIGKILL";

function positiveTimeout(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

export function boundedSpawnSync(
  command,
  args = [],
  options = {},
  {
    spawn = spawnSync,
    timeoutMs = DEFAULT_SUBPROCESS_TIMEOUT_MS,
  } = {},
) {
  const timeout = positiveTimeout(options.timeout, positiveTimeout(timeoutMs, DEFAULT_SUBPROCESS_TIMEOUT_MS));
  const result = spawn(command, args, {
    ...options,
    timeout,
    // spawnSync waits after the timeout until the child actually exits. A
    // catchable SIGTERM therefore does not provide a bounded lifetime. Use the
    // non-catchable termination signal unless a caller explicitly requests a
    // different policy.
    killSignal: options.killSignal || DEFAULT_SUBPROCESS_KILL_SIGNAL,
  });

  if (result?.error?.code === "ETIMEDOUT") {
    const detail = `subprocess_timeout:${command}:${timeout}ms`;
    return {
      ...result,
      stderr: String(result.stderr || "").trim() || detail,
    };
  }
  return result;
}
