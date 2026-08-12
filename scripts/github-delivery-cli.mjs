#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import { parseBootstrapArgs } from "./lib/bootstrap-cli.mjs";
import { runBootstrap } from "./lib/bootstrap-command.mjs";

export const HELP_TEXT = `GitHub Delivery\n\nUsage:\n  github-delivery\n  github-delivery install [--target PATH]\n  github-delivery setup [--target PATH]\n  github-delivery doctor [--target PATH]\n  github-delivery update [--target PATH] [--apply]\n\nBare invocation launches guided setup.\nUpdate is dry-run by default; add --apply only after reviewing the plan.\n`;

function printResult(result, stdout = process.stdout) {
  if (!result || result.action === "help") return;
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const parse = dependencies.parseBootstrapArgs || parseBootstrapArgs;
  const options = parse(argv);
  if (options.help) {
    process.stdout.write(HELP_TEXT);
    return { action: "help" };
  }
  const result = await (dependencies.runBootstrap || runBootstrap)(argv, dependencies);
  printResult(result, dependencies.stdout || process.stdout);
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 1;
  });
}
