import { spawnSync } from "node:child_process";

export const DEFAULT_SUBPROCESS_TIMEOUT_MS = 120_000;
export const DEFAULT_SUBPROCESS_KILL_SIGNAL = "SIGKILL";

function positiveTimeout(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function assertDirectSpawnArgv(command, args) {
  if (typeof command !== "string" || command.length === 0 || command.includes("\0")) {
    throw new Error("subprocess_command_invalid");
  }
  if (!Array.isArray(args)) throw new Error("subprocess_args_invalid");
  return {
    command,
    args: args.map((value, index) => {
      if (typeof value !== "string" || value.includes("\0")) {
        throw new Error(`subprocess_arg_invalid:${index}`);
      }
      return String(value);
    }),
  };
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
  const argv = assertDirectSpawnArgv(command, args);
  const timeout = positiveTimeout(options.timeout, positiveTimeout(timeoutMs, DEFAULT_SUBPROCESS_TIMEOUT_MS));
  const { shell: _ignoredShell, timeout: _ignoredTimeout, killSignal, ...rest } = options;
  const result = spawn(argv.command, argv.args, {
    ...rest,
    timeout,
    // spawnSync waits after the timeout until the child actually exits. A
    // catchable SIGTERM therefore does not provide a bounded lifetime. Use the
    // non-catchable termination signal unless a caller explicitly requests a
    // different policy. Never honor a caller-supplied `shell` flag: argv must
    // stay a direct spawn, not a reconstructed shell command.
    killSignal: killSignal || DEFAULT_SUBPROCESS_KILL_SIGNAL,
    shell: false,
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
