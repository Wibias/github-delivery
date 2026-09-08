import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "../..");

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    ...options,
  });
}

function runCmd(command) {
  return run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", command]);
}

function assertSuccess(result, label) {
  assert.equal(
    result.status,
    0,
    `${label} failed\nerror:\n${result.error?.stack || result.error || ""}\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`,
  );
}

test("installed Windows trace bins execute their CLI entrypoints", {
  skip: process.platform !== "win32",
}, () => {
  const workspace = mkdtempSync(join(tmpdir(), "github-delivery-trace-bin-"));
  const packDir = join(workspace, "pack");
  const prefix = join(workspace, "prefix");
  mkdirSync(packDir, { recursive: true });

  const pack = runCmd(`npm pack --json --pack-destination "${packDir}"`);
  assertSuccess(pack, "npm pack");
  const packed = JSON.parse(pack.stdout);
  assert.equal(Array.isArray(packed), true);
  assert.equal(packed.length, 1);
  const tarball = join(packDir, packed[0].filename);

  const install = runCmd(
    `npm install --global --prefix "${prefix}" "${tarball}" --ignore-scripts --no-audit --no-fund`,
  );
  assertSuccess(install, "temporary global npm install");

  const probes = [
    {
      name: "grok-trace",
      args: [],
      stderr: /grok-trace requires a prompt or --prompt-file/,
    },
    {
      name: "cursor-trace",
      args: ["--output-format", "json"],
      stderr: /Cursor debug trace wrapper owns --output-format/,
    },
    {
      name: "codex-trace",
      args: ["--remote", "ws:\/\/127.0.0.1:1"],
      stderr: /protected Codex launcher owns --remote/,
    },
  ];

  for (const probe of probes) {
    const shim = join(prefix, `${probe.name}.cmd`);
    const command = `"${shim}" ${probe.args.join(" ")}`.trim();
    const result = runCmd(command);

    assert.equal(
      result.status,
      1,
      `${probe.name} should execute and reject the probe arguments\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`,
    );
    assert.match(result.stderr || "", probe.stderr);
  }
});
