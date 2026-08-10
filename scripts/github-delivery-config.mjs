#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { runConfigCommand } from "./lib/config-command.mjs";

export function main(argv = process.argv.slice(2)) {
  const result = runConfigCommand({ argv });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); }
  catch (error) {
    process.stderr.write(`${JSON.stringify({ error: String(error?.message || error) })}\n`);
    process.exitCode = 1;
  }
}
