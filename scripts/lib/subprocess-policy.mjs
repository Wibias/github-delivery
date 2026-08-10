import { spawnSync } from "node:child_process";

export const DEFAULT_SUBPROCESS_TIMEOUT_MS = 120_000;

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
    killSignal: options.killSignal || "SIGTERM",
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
