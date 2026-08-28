import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { win32 as win32Path } from "node:path";

export const DEFAULT_SUBPROCESS_TIMEOUT_MS = 120_000;
export const DEFAULT_SUBPROCESS_KILL_SIGNAL = "SIGKILL";

const WINDOWS_PROTECTED_COMMANDS = new Set([
  "gh",
  "gh.com",
  "gh.exe",
  "git",
  "git.com",
  "git.exe",
]);

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

function windowsPathValue(env = {}) {
  for (const [key, value] of Object.entries(env || {})) {
    if (key.toLowerCase() === "path") return String(value || "");
  }
  return "";
}

function stripOuterQuotes(value) {
  const text = String(value || "").trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1);
  }
  return text;
}

function windowsWorktreeRoot(cwd, exists) {
  let current = win32Path.resolve(cwd);
  const fallback = current;
  while (true) {
    if (exists(win32Path.join(current, ".git"))) return current;
    const parent = win32Path.dirname(current);
    if (parent === current) return fallback;
    current = parent;
  }
}

function windowsPathInside(root, candidate) {
  const normalizedRoot = win32Path.resolve(root).replace(/[\\/]+$/, "").toLowerCase();
  const normalizedCandidate = win32Path.resolve(candidate).toLowerCase();
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}\\`)
  );
}

function windowsExecutableNames(command) {
  const extension = win32Path.extname(command).toLowerCase();
  if (extension === ".exe" || extension === ".com") return [command];
  return [`${command}.com`, `${command}.exe`];
}

function resolveWindowsProtectedCommand(
  command,
  {
    cwd,
    env,
    exists,
    canonicalizePath,
  },
) {
  if (win32Path.basename(command) !== command) return command;
  if (!WINDOWS_PROTECTED_COMMANDS.has(command.toLowerCase())) return command;

  const worktreeRoot = canonicalizePath(windowsWorktreeRoot(cwd, exists));
  for (const entry of windowsPathValue(env).split(";")) {
    const directory = stripOuterQuotes(entry);
    if (!directory || !win32Path.isAbsolute(directory)) continue;
    for (const name of windowsExecutableNames(command)) {
      const candidate = win32Path.join(directory, name);
      if (!exists(candidate)) continue;
      let resolved;
      try {
        resolved = canonicalizePath(candidate);
      } catch {
        continue;
      }
      if (windowsPathInside(worktreeRoot, resolved)) continue;
      return resolved;
    }
  }
  throw new Error(`subprocess_command_unresolved:${command}`);
}

export function boundedSpawnSync(
  command,
  args = [],
  options = {},
  {
    spawn = spawnSync,
    timeoutMs = DEFAULT_SUBPROCESS_TIMEOUT_MS,
    platform = process.platform,
    cwd = options.cwd || process.cwd(),
    env = options.env || process.env,
    exists = existsSync,
    canonicalizePath = realpathSync.native,
  } = {},
) {
  const argv = assertDirectSpawnArgv(command, args);
  const executable =
    platform === "win32"
      ? resolveWindowsProtectedCommand(argv.command, {
          cwd,
          env,
          exists,
          canonicalizePath,
        })
      : argv.command;
  const timeout = positiveTimeout(options.timeout, positiveTimeout(timeoutMs, DEFAULT_SUBPROCESS_TIMEOUT_MS));
  const { shell: _ignoredShell, timeout: _ignoredTimeout, killSignal, ...rest } = options;
  const result = spawn(executable, argv.args, {
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
