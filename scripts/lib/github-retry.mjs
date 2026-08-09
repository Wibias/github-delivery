import { spawnSync } from "node:child_process";

const RATE_LIMIT_RE = /(?:HTTP\s+429|secondary rate limit|API rate limit exceeded|rate limit)/i;
const RETRY_AFTER_RE = /retry-after\s*:?\s*(\d+)/i;
const RESET_RE = /x-ratelimit-reset\s*:?\s*(\d+)/i;

function methodFromArgs(args) {
  let method = null;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "-X" || args[index] === "--method") {
      method = String(args[index + 1] || "").toUpperCase();
      index += 1;
    }
  }
  return method;
}

function graphqlQuery(args) {
  for (let index = 0; index < args.length - 1; index += 1) {
    if (!["-f", "-F", "--raw-field", "--field"].includes(args[index])) continue;
    const value = String(args[index + 1] || "");
    if (value.startsWith("query=")) return value.slice("query=".length);
  }
  return "";
}

export function isReadOnlyGitHubCommand(command, args = []) {
  if (command !== "gh" || !Array.isArray(args) || args.length === 0) return false;
  const [group, subcommand] = args;
  if (group === "api") {
    const method = methodFromArgs(args);
    if (String(subcommand || "") === "graphql") {
      if (method && method !== "GET" && method !== "POST") return false;
      return !/\bmutation\b/i.test(graphqlQuery(args));
    }
    if (method) return method === "GET";
    // gh api switches to POST when fields are supplied without an explicit GET.
    if (args.some((value) => ["-f", "-F", "--raw-field", "--field"].includes(value))) {
      return false;
    }
    return true;
  }
  if (group === "auth" && subcommand === "status") return true;
  if (group === "repo" && subcommand === "view") return true;
  if (group === "pr" && ["view", "checks", "list", "status", "diff"].includes(subcommand)) return true;
  if (group === "issue" && ["view", "list", "status"].includes(subcommand)) return true;
  if (group === "run" && ["view", "list"].includes(subcommand)) return true;
  return false;
}

export function classifyGitHubRateLimit(result = {}) {
  if (result?.status === 0) return { rateLimited: false, delayMs: 0 };
  const text = `${String(result?.stderr || "")}\n${String(result?.stdout || "")}`;
  if (!RATE_LIMIT_RE.test(text)) return { rateLimited: false, delayMs: 0 };
  const retryAfter = text.match(RETRY_AFTER_RE);
  if (retryAfter) {
    return { rateLimited: true, delayMs: Math.max(0, Number(retryAfter[1]) * 1000) };
  }
  const reset = text.match(RESET_RE);
  if (reset) {
    return {
      rateLimited: true,
      resetEpochSeconds: Number(reset[1]),
      delayMs: null,
    };
  }
  return { rateLimited: true, delayMs: null };
}

function defaultSleep(ms) {
  if (ms <= 0) return;
  const wait = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(wait, 0, 0, ms);
}

export function runGitHubCommandWithRetry(
  command,
  args,
  {
    runner = (executable, argv, options) => spawnSync(executable, argv, options),
    options = {},
    maxAttempts = 3,
    maxDelayMs = 60_000,
    now = () => Date.now(),
    sleep = defaultSleep,
  } = {},
) {
  const attempts = Math.max(1, Number(maxAttempts) || 1);
  const readOnly = isReadOnlyGitHubCommand(command, args);
  let result;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    result = runner(command, args, options);
    if (result?.status === 0) return { ...result, githubDeliveryAttempts: attempt };
    const rate = classifyGitHubRateLimit(result);
    if (!readOnly || !rate.rateLimited || attempt >= attempts) {
      return { ...result, githubDeliveryAttempts: attempt };
    }
    let delayMs;
    if (rate.delayMs !== null) {
      delayMs = rate.delayMs;
    } else if (rate.resetEpochSeconds) {
      delayMs = Math.max(0, rate.resetEpochSeconds * 1000 - now());
    } else {
      delayMs = 1000 * 2 ** (attempt - 1);
    }
    sleep(Math.min(maxDelayMs, delayMs));
  }
  return result;
}
