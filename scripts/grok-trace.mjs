#!/usr/bin/env node
import { runGrokWithDebugTrace } from "./grok-with-debug-trace.mjs";
import { isDirectExecution } from "./lib/direct-execution.mjs";
import {
  buildGrokTraceDeliveryContract,
  buildGrokTraceEnv,
  buildGrokTraceLauncherArgs,
  verifyGrokTraceDeliveryContract,
} from "./lib/grok-trace-launcher.mjs";

export function runGrokTrace({
  args = process.argv.slice(2),
  env = process.env,
  cwd = process.cwd(),
  stderr = process.stderr,
  runImpl = runGrokWithDebugTrace,
  verifyDeliveryContract = verifyGrokTraceDeliveryContract,
  deliverySpawnSyncImpl,
  ...options
} = {}) {
  const launcherArgs = buildGrokTraceLauncherArgs(args);
  const contract = buildGrokTraceDeliveryContract(args, { cwd });
  const result = runImpl({
    ...options,
    args: launcherArgs,
    env: buildGrokTraceEnv(env),
    stderr,
  });

  if (contract.requirePullRequest && result?.child?.once) {
    result.child.once("exit", (code, signal) => {
      if (signal || code !== 0) return;
      try {
        const verified = verifyDeliveryContract(contract, {
          cwd,
          env,
          ...(deliverySpawnSyncImpl ? { spawnSyncImpl: deliverySpawnSyncImpl } : {}),
        });
        if (verified?.pullRequestVerified) {
          stderr.write(`github-delivery grok-trace delivery verified: PR #${verified.number}\n`);
        }
      } catch (error) {
        stderr.write(
          `github-delivery grok-trace delivery contract failed: ${error?.message || error}\n`,
        );
        process.exitCode = 1;
      }
    });
  }

  return { ...result, deliveryContract: contract };
}

if (isDirectExecution(import.meta.url)) {
  try {
    runGrokTrace();
  } catch (error) {
    process.stderr.write(`github-delivery grok-trace failed: ${error?.message || error}\n`);
    process.exitCode = 1;
  }
}
