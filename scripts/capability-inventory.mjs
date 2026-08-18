#!/usr/bin/env node
import { boundedSpawnSync } from "./lib/subprocess-policy.mjs";

import { collectCapabilityInventory } from "./lib/capability-inventory.mjs";

const REGISTRY = [
  { id: "git", commands: [{ command: "git", args: ["--version"] }] },
  { id: "gh", commands: [{ command: "gh", args: ["--version"] }] },
  { id: "node", commands: [{ command: "node", args: ["--version"] }] },
  { id: "npm", commands: [{ command: "npm", args: ["--version"] }] },
  { id: "semgrep", commands: [{ command: "semgrep", args: ["--version"] }] },
  { id: "codeql", commands: [{ command: "codeql", args: ["version"] }] },
  {
    id: "promptfoo",
    commands: [
      { command: "promptfoo", args: ["--version"] },
      { command: "npx", args: ["--no-install", "promptfoo", "--version"] },
    ],
  },
  { id: "python", commands: [{ command: "python", args: ["--version"] }, { command: "python3", args: ["--version"] }] },
  { id: "pyrit", commands: [{ command: "pyrit_scan", args: ["--help"] }] },
  { id: "garak", commands: [{ command: "garak", args: ["--version"] }] },
  { id: "human-review", commands: [{ command: "human-review", args: ["--help"] }] },
];

function runner({ command, args }) {
  const result = boundedSpawnSync(command, args, {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 5000,
  });
  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    errorCode: result.error?.code || null,
  };
}

try {
  const inventory = collectCapabilityInventory({ registry: REGISTRY, runner });
  process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
