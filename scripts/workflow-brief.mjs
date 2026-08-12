#!/usr/bin/env node
import { resolve } from "node:path";

import { buildWorkflowPacket } from "./lib/delivery-workflow-profiles.mjs";

const USAGE =
  "Usage: node scripts/workflow-brief.mjs WORKFLOW [--root ROOT] [--conditional MODULE ...]";

function parseArgs(argv) {
  const workflow = argv[0];
  if (!workflow) throw new Error(USAGE);
  let root = process.cwd();
  const activeConditionalModules = [];
  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--root") {
      root = argv[++index];
      if (!root) throw new Error("--root requires a path");
    } else if (value === "--conditional") {
      const module = argv[++index];
      if (!module) throw new Error("--conditional requires a module name");
      activeConditionalModules.push(module);
    } else {
      throw new Error(`Unknown option: ${value}\n${USAGE}`);
    }
  }
  return { workflow, root: resolve(root), activeConditionalModules };
}

try {
  const args = parseArgs(process.argv.slice(2));
  const packet = buildWorkflowPacket(args);
  process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`);
} catch (error) {
  console.error(String(error?.message || error));
  process.exitCode = 2;
}
