#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import { main as installMain } from "./install-skill.mjs";

export async function runUpdateCommand(argv = process.argv.slice(2), dependencies = {}) {
  const runInstaller = dependencies.installMain || installMain;
  return runInstaller(["--update", ...argv]);
}

export async function main(argv = process.argv.slice(2)) {
  return runUpdateCommand(argv);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      error: String(error?.message || error),
      ...(error?.backupPath ? { backupPath: error.backupPath } : {}),
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
