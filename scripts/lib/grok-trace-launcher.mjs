import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildAgentTraceEnv } from "./agent-trace-launcher.mjs";

function isHeadless(args) {
  return args.some((arg) =>
    arg === "-p" ||
    arg === "--prompt" ||
    arg === "--prompt-file" ||
    arg.startsWith("--prompt=") ||
    arg.startsWith("--prompt-file="),
  );
}

function promptText(args, { readFileSyncImpl = readFileSync, cwd = process.cwd() } = {}) {
  const input = Array.from(args, (arg) => String(arg));
  if (input.length === 1 && input[0].length > 0 && !input[0].startsWith("-")) return input[0];

  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index];
    if ((arg === "-p" || arg === "--prompt") && input[index + 1]) return input[index + 1];
    if (arg.startsWith("--prompt=")) return arg.slice("--prompt=".length);
    if (arg === "--prompt-file" && input[index + 1]) {
      try {
        return readFileSyncImpl(resolve(cwd, input[index + 1]), "utf8");
      } catch {
        return null;
      }
    }
    if (arg.startsWith("--prompt-file=")) {
      try {
        return readFileSyncImpl(resolve(cwd, arg.slice("--prompt-file=".length)), "utf8");
      } catch {
        return null;
      }
    }
  }
  return null;
}

function explicitlyRequestsPullRequest(prompt) {
  const text = String(prompt || "");
  if (!text) return false;
  if (/\b(?:do\s+not|don['’]?t|dont|without)\b[^.!?\n]{0,80}\b(?:open|create|raise|submit)\b[^.!?\n]{0,40}\b(?:pr|pull\s+request)\b/i.test(text)) {
    return false;
  }
  return /\b(?:open|create|raise|submit)\s+(?:(?:a|an)\s+)?(?:draft\s+)?(?:pr|pull\s+request)\b/i.test(text);
}

function runVerificationCommand(spawnSyncImpl, bin, args, { cwd, env, stage }) {
  const result = spawnSyncImpl(bin, args, {
    cwd,
    env,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result?.error || result?.status !== 0) {
    throw new Error(`grok_trace_delivery_verification_failed:${stage}`);
  }
  return String(result?.stdout || "").trim();
}

export function buildGrokTraceLauncherArgs(args = []) {
  const input = Array.from(args, (arg) => String(arg));

  if (input.length === 1 && input[0].length > 0 && !input[0].startsWith("-")) {
    return ["-p", input[0]];
  }

  if (isHeadless(input)) return input;

  if (input.length === 0) {
    throw new Error("grok-trace requires a prompt or --prompt-file");
  }

  throw new Error(
    "grok-trace requires -p/--prompt/--prompt-file when passing Grok options; quote a plain prompt to use shorthand",
  );
}

export function buildGrokTraceEnv(env = process.env) {
  return buildAgentTraceEnv(env);
}

export function buildGrokTraceDeliveryContract(args = [], options = {}) {
  return {
    requirePullRequest: explicitlyRequestsPullRequest(promptText(args, options)),
  };
}

export function verifyGrokTraceDeliveryContract(
  contract,
  {
    spawnSyncImpl = spawnSync,
    cwd = process.cwd(),
    env = process.env,
  } = {},
) {
  if (!contract?.requirePullRequest) return { pullRequestVerified: false };

  const branch = runVerificationCommand(
    spawnSyncImpl,
    "git",
    ["rev-parse", "--abbrev-ref", "HEAD"],
    { cwd, env, stage: "current_branch" },
  );
  if (!branch || branch === "HEAD") {
    throw new Error("grok_trace_delivery_contract_unmet:pull_request_branch_unavailable");
  }

  const head = runVerificationCommand(
    spawnSyncImpl,
    "git",
    ["rev-parse", "HEAD"],
    { cwd, env, stage: "current_head" },
  );

  const json = runVerificationCommand(
    spawnSyncImpl,
    "gh",
    [
      "pr",
      "list",
      "--head",
      branch,
      "--state",
      "open",
      "--json",
      "number,url,headRefName,headRefOid",
      "--limit",
      "1",
    ],
    { cwd, env, stage: "pull_request_lookup" },
  );

  let pullRequests;
  try {
    pullRequests = JSON.parse(json || "[]");
  } catch {
    throw new Error("grok_trace_delivery_verification_failed:pull_request_response");
  }
  const pullRequest = Array.isArray(pullRequests) ? pullRequests[0] : null;
  if (!pullRequest || pullRequest.headRefName !== branch) {
    throw new Error("grok_trace_delivery_contract_unmet:pull_request_not_verified");
  }
  if (!head || pullRequest.headRefOid !== head) {
    throw new Error("grok_trace_delivery_contract_unmet:pull_request_head_not_current");
  }

  return {
    pullRequestVerified: true,
    number: pullRequest.number,
    url: pullRequest.url,
  };
}
