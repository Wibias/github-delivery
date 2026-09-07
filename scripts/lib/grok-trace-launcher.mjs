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
