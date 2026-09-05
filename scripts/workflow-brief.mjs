#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bootstrapLocalPrWorkflow } from "./lib/workflow-bootstrap.mjs";
import { buildExecutionWorkflowPacket } from "./lib/workflow-execution-contract.mjs";

const LOCAL_PR_WORKFLOW = "create-pr-from-local-work";
const USAGE =
  "Usage: node scripts/workflow-brief.mjs WORKFLOW [--root ROOT] [--conditional MODULE ...] [--repo OWNER/REPO --head SHA [--base SHA]]";
const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const workflow = argv[0];
  if (!workflow) throw new Error(USAGE);
  let root = DEFAULT_ROOT;
  let repo = null;
  let headSha = null;
  let baseSha = null;
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
    } else if (value === "--repo") {
      repo = argv[++index];
      if (!repo) throw new Error("--repo requires OWNER/REPO");
    } else if (value === "--head") {
      headSha = argv[++index];
      if (!headSha) throw new Error("--head requires a SHA");
    } else if (value === "--base") {
      baseSha = argv[++index];
      if (!baseSha) throw new Error("--base requires a SHA");
    } else {
      throw new Error(`Unknown option: ${value}\n${USAGE}`);
    }
  }
  return {
    workflow,
    root: resolve(root),
    activeConditionalModules,
    repo,
    headSha,
    baseSha,
  };
}

try {
  const args = parseArgs(process.argv.slice(2));
  const packet = buildExecutionWorkflowPacket(args);
  if (args.workflow === LOCAL_PR_WORKFLOW) {
    if (!args.repo || !args.headSha) {
      throw new Error("create-pr-from-local-work requires --repo and --head");
    }
    packet.controller = bootstrapLocalPrWorkflow({
      repo: args.repo,
      headSha: args.headSha,
      baseSha: args.baseSha,
    });
  } else if (args.repo || args.headSha || args.baseSha) {
    throw new Error("--repo, --head, and --base are only supported by create-pr-from-local-work");
  }
  process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`);
} catch (error) {
  console.error(String(error?.message || error));
  process.exitCode = 2;
}
