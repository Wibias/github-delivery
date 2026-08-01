import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "../..");
const COMMAND = join(ROOT, "scripts", "runtime-capabilities.mjs");

function fixture(input) {
  const directory = mkdtempSync(join(tmpdir(), "shipping-github-capabilities-"));
  const path = join(directory, "input.json");
  writeFileSync(path, JSON.stringify(input), "utf8");
  return path;
}

test("prints a deterministic offline capability snapshot", () => {
  const path = fixture({
    host: "codex",
    os: "win32",
    repo: "acme/widgets",
    probes: {
      node: true,
      git: true,
      gh: false,
      ghAuthenticated: false,
    },
    declarations: {
      connectorRead: true,
      connectorWrite: true,
      subagents: true,
      reviewThreadsReadable: true,
      rulesetsReadable: true,
    },
  });
  const result = spawnSync(process.execPath, [COMMAND, "--input", path], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, PATH: "" },
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.repo, "acme/widgets");
  assert.equal(output.fallbacks.githubReads, "connector");
  assert.equal(output.fallbacks.githubWrites, "connector");
  assert.equal(output.readyForMutation, true);
});

test("returns two when neither connector nor gh can read GitHub", () => {
  const path = fixture({
    probes: { node: true, git: true, gh: false, ghAuthenticated: false },
    declarations: {},
  });
  const result = spawnSync(process.execPath, [COMMAND, "--input", path], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, PATH: "" },
  });
  assert.equal(result.status, 2);
  assert.ok(JSON.parse(result.stdout).degraded.includes("github_read_unavailable"));
});
