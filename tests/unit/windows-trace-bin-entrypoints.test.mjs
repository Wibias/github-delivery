import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { resolveNpmCli } from "../../scripts/lib/npm-cli.mjs";

const ROOT = resolve(import.meta.dirname, "../..");

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    ...options,
  });
}

function runNpm(args) {
  return run(process.execPath, [resolveNpmCli(), ...args]);
}

function runPowerShellFile(path, args = []) {
  return run("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path,
    ...args,
  ]);
}

function assertSuccess(result, label) {
  assert.equal(
    result.status,
    0,
    `${label} failed\nerror:\n${result.error?.stack || result.error || ""}\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`,
  );
}

function assertRejected(result, probe, label = probe.name) {
  assert.equal(
    result.status,
    1,
    `${label} should execute and reject the probe arguments\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`,
  );
  assert.match(result.stderr || "", probe.stderr);
}

test("installed Windows trace bins execute through canonical and aliased package paths", {
  skip: process.platform !== "win32",
}, () => {
  const workspace = mkdtempSync(join(tmpdir(), "github-delivery-trace-bin-"));
  const packDir = join(workspace, "pack");
  const prefix = join(workspace, "prefix");
  mkdirSync(packDir, { recursive: true });

  const pack = runNpm(["pack", "--json", "--pack-destination", packDir]);
  assertSuccess(pack, "npm pack");
  const packed = JSON.parse(pack.stdout);
  assert.equal(Array.isArray(packed), true);
  assert.equal(packed.length, 1);
  const tarball = join(packDir, packed[0].filename);

  const install = runNpm([
    "install",
    "--global",
    "--prefix",
    prefix,
    tarball,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ]);
  assertSuccess(install, "temporary global npm install");

  const publicProbes = [
    {
      name: "grok-trace",
      script: "grok-trace.mjs",
      args: [],
      stderr: /grok-trace requires a prompt or --prompt-file/,
    },
    {
      name: "cursor-trace",
      script: "cursor-trace.mjs",
      args: ["--output-format", "json"],
      stderr: /Cursor debug trace wrapper owns --output-format/,
    },
    {
      name: "codex-trace",
      script: "codex-trace.mjs",
      args: ["--remote", "ws:\/\/127.0.0.1:1"],
      stderr: /protected Codex launcher owns --remote/,
    },
  ];

  for (const probe of publicProbes) {
    const shim = join(prefix, `${probe.name}.ps1`);
    assert.equal(existsSync(shim), true, `expected installed PowerShell shim: ${shim}`);
    assertRejected(runPowerShellFile(shim, probe.args), probe);
  }

  const packageRoot = join(prefix, "node_modules", "github-delivery");
  const aliasRoot = join(workspace, "github-delivery-alias");
  symlinkSync(packageRoot, aliasRoot, "junction");

  const directProbes = [
    ...publicProbes,
    {
      name: "grok-with-debug-trace",
      script: "grok-with-debug-trace.mjs",
      args: [],
      stderr: /Grok debug tracing requires a headless/,
    },
    {
      name: "cursor-with-debug-trace",
      script: "cursor-with-debug-trace.mjs",
      args: ["--output-format", "json"],
      stderr: /Cursor debug trace wrapper owns --output-format/,
    },
    {
      name: "codex-with-watchdog",
      script: "codex-with-watchdog.mjs",
      args: ["--remote", "ws:\/\/127.0.0.1:1"],
      stderr: /protected Codex launcher owns --remote/,
    },
  ];

  for (const probe of directProbes) {
    const script = join(aliasRoot, "scripts", probe.script);
    assertRejected(
      run(process.execPath, [script, ...probe.args]),
      probe,
      `${probe.name} via junction`,
    );
  }
});
