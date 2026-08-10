import assert from "node:assert/strict";
import test from "node:test";

import { collectCapabilityInventory } from "../../scripts/lib/capability-inventory.mjs";

function runner(map) {
  return ({ command, args }) => {
    const key = `${command} ${args.join(" ")}`;
    return map[key] ?? { status: null, errorCode: "ENOENT", stdout: "", stderr: "" };
  };
}

test("records available capabilities with concrete command/version evidence", () => {
  const result = collectCapabilityInventory({
    registry: [
      { id: "git", commands: [{ command: "git", args: ["--version"] }] },
      { id: "semgrep", commands: [{ command: "semgrep", args: ["--version"] }] },
    ],
    runner: runner({
      "git --version": { status: 0, stdout: "git version 2.50.1\n", stderr: "" },
    }),
  });

  assert.equal(result.capabilities.git.status, "available");
  assert.match(result.capabilities.git.versionEvidence, /2\.50\.1/);
  assert.equal(result.capabilities.semgrep.status, "unavailable");
});

test("tries declared aliases without executing install commands", () => {
  const calls = [];
  const result = collectCapabilityInventory({
    registry: [{
      id: "promptfoo",
      commands: [
        { command: "promptfoo", args: ["--version"] },
        { command: "npx", args: ["--no-install", "promptfoo", "--version"] },
      ],
    }],
    runner({ command, args }) {
      calls.push([command, ...args].join(" "));
      if (command === "npx") return { status: 0, stdout: "0.120.0\n", stderr: "" };
      return { status: null, errorCode: "ENOENT", stdout: "", stderr: "" };
    },
  });

  assert.deepEqual(calls, ["promptfoo --version", "npx --no-install promptfoo --version"]);
  assert.equal(result.capabilities.promptfoo.status, "available");
  assert.equal(result.mutationsPerformed, false);
  assert.equal(result.installAttempts, 0);
});

test("unknown or failing tools are evidence, not blockers for unrelated capabilities", () => {
  const result = collectCapabilityInventory({
    registry: [
      { id: "codeql", commands: [{ command: "codeql", args: ["version"] }] },
      { id: "git", commands: [{ command: "git", args: ["--version"] }] },
    ],
    runner: runner({
      "codeql version": { status: 2, stdout: "", stderr: "configuration error" },
      "git --version": { status: 0, stdout: "git version 2.50.1", stderr: "" },
    }),
  });

  assert.equal(result.capabilities.codeql.status, "error");
  assert.match(result.capabilities.codeql.detail, /configuration error/);
  assert.equal(result.capabilities.git.status, "available");
});

test("inventory preserves a deterministic registry order", () => {
  const result = collectCapabilityInventory({
    registry: [
      { id: "z-tool", commands: [{ command: "z", args: ["--version"] }] },
      { id: "a-tool", commands: [{ command: "a", args: ["--version"] }] },
    ],
    runner: runner({}),
  });
  assert.deepEqual(result.order, ["z-tool", "a-tool"]);
});

test("invalid registry commands fail closed", () => {
  assert.throws(() => collectCapabilityInventory({
    registry: [{ id: "bad", commands: [{ command: "npm install bad", args: [] }] }],
    runner: runner({}),
  }), /unsafe capability command/);
});
