#!/usr/bin/env node
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { applyInstallation, planInstallation, restoreBackup } from "./lib/distribution.mjs";

export function parseInstallArgs(argv) {
  const options = {
    source: join(process.cwd(), "dist", "shipping-github"),
    target: join(homedir(), ".agents", "skills", "shipping-github"),
    backupRoot: undefined,
    apply: false,
    allowDowngrade: false,
    force: false,
    restore: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source") options.source = argv[++index];
    else if (arg === "--target") options.target = argv[++index];
    else if (arg === "--backup-root") options.backupRoot = argv[++index];
    else if (arg === "--restore") options.restore = argv[++index];
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--allow-downgrade") options.allowDowngrade = true;
    else if (arg === "--force") options.force = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  options.source = resolve(options.source);
  options.target = resolve(options.target);
  if (options.backupRoot) options.backupRoot = resolve(options.backupRoot);
  if (options.restore) options.restore = resolve(options.restore);
  return options;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseInstallArgs(argv);
  let result;
  if (options.restore) {
    result = options.apply
      ? restoreBackup({ backup: options.restore, target: options.target })
      : { action: "restore", apply: false, backup: options.restore, target: options.target };
  } else if (options.apply) {
    result = applyInstallation(options);
  } else {
    result = { ...planInstallation(options), apply: false };
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: String(error?.message || error) }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
