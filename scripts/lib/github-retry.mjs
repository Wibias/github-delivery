import { boundedSpawnSync } from "./subprocess-policy.mjs";

const RATE_LIMIT_RE = /(?:HTTP\s+429|secondary rate limit|API rate limit exceeded|rate limit)/i;
const RETRY_AFTER_RE = /retry-after\s*:?\s*(\d+)/i;
const RESET_RE = /x-ratelimit-reset\s*:?\s*(\d+)/i;
const DEFAULT_SECONDARY_DELAY_MS = 60_000;

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

function hasStdinBody(args) {
  return args.some((value) => {
    const flag = String(value || "");
    return flag === "--input"
      || flag === "--body-file"
      || flag.startsWith("--input=")
      || flag.startsWith("--body-file=");
  });
}

export function isReadOnlyGitHubCommand(command, args = []) {
  if (command !== "gh" || !Array.isArray(args) || args.length === 0) return false;
  const [group, subcommand] = args;
  if (group === "api") {
    const method = methodFromArgs(args);
    const stdinBody = hasStdinBody(args);
    if (String(subcommand || "") === "graphql") {
      if (method && method !== "GET" && method !== "POST") return false;
      if (stdinBody && !graphqlQuery(args)) return false;
      return !/\bmutation\b/i.test(graphqlQuery(args));
    }
    if (method) return method === "GET";
    // gh api switches to POST when fields or an HTTP body are supplied without GET.
    if (stdinBody) return false;
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
  if (result?.status === 0) {
    return { rateLimited: false, delayMs: 0, source: null };
  }
  const text = `${String(result?.stderr || "")}\n${String(result?.stdout || "")}`;
  if (!RATE_LIMIT_RE.test(text)) {
    return { rateLimited: false, delayMs: 0, source: null };
  }
  const retryAfter = text.match(RETRY_AFTER_RE);
  if (retryAfter) {
    return {
      rateLimited: true,
      delayMs: Math.max(0, Number(retryAfter[1]) * 1000),
      source: "retry_after",
    };
  }
  const reset = text.match(RESET_RE);
  if (reset) {
    return {
      rateLimited: true,
      resetEpochSeconds: Number(reset[1]),
      delayMs: null,
      source: "rate_limit_reset",
    };
  }
  return { rateLimited: true, delayMs: null, source: "secondary_fallback" };
}

function defaultSleep(ms) {
  if (ms <= 0) return;
  const wait = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(wait, 0, 0, ms);
}

function fallbackDelayMs(attempt, random) {
  const base = DEFAULT_SECONDARY_DELAY_MS * 2 ** Math.max(0, attempt - 1);
  const positiveJitter = Math.floor(base * 0.25 * Math.max(0, Math.min(1, random())));
  return base + positiveJitter;
}

export function runGitHubCommandWithRetry(
  command,
  args,
  {
    runner = boundedSpawnSync,
    options = {},
    maxAttempts = 3,
    maxDelayMs = 60_000,
    now = () => Date.now(),
    sleep = defaultSleep,
    random = Math.random,
  } = {},
) {
  const attempts = Math.max(1, Number(maxAttempts) || 1);
  const readOnly = isReadOnlyGitHubCommand(command, args);
  let result;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    result = runner(command, args, options);
    if (result?.status === 0) {
      return { ...result, githubDeliveryAttempts: attempt };
    }
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
      delayMs = fallbackDelayMs(attempt, random);
    }

    // Never shorten a server-directed wait just to stay inside the synchronous
    // retry budget. Returning the rate-limit result is safer than retrying early.
    if (delayMs > maxDelayMs) {
      return {
        ...result,
        githubDeliveryAttempts: attempt,
        githubDeliveryRetryDeferredMs: delayMs,
        githubDeliveryRetrySource: rate.source,
      };
    }

    sleep(delayMs);
  }
  return result;
}
