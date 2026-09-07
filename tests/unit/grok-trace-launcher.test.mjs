import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "../..");

const GROK_TRACE_RUNTIME = [
  "scripts/grok-trace.mjs",
  "scripts/grok-with-debug-trace.mjs",
  "scripts/lib/grok-trace-launcher.mjs",
  "scripts/lib/grok-debug-trace.mjs",
  "scripts/lib/structured-debug-cli.mjs",
  "scripts/lib/agent-debug-trace.mjs",
];

test("package exposes the first-class grok-trace launcher and its runtime", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

  assert.equal(pkg.bin?.["grok-trace"], "scripts/grok-trace.mjs");
  for (const path of GROK_TRACE_RUNTIME) {
    assert(pkg.files?.includes(path), `missing grok-trace packed runtime: ${path}`);
  }
});

test("grok-trace accepts one quoted prompt as safe headless shorthand", async () => {
  const { buildGrokTraceLauncherArgs } = await import(
    "../../scripts/lib/grok-trace-launcher.mjs"
  );

  assert.deepEqual(buildGrokTraceLauncherArgs(["inspect this repository"]), [
    "-p",
    "inspect this repository",
  ]);
  assert.deepEqual(buildGrokTraceLauncherArgs(["-p", "inspect this repository"]), [
    "-p",
    "inspect this repository",
  ]);
  assert.deepEqual(buildGrokTraceLauncherArgs(["--prompt", "inspect this repository"]), [
    "--prompt",
    "inspect this repository",
  ]);
  assert.deepEqual(buildGrokTraceLauncherArgs(["--prompt-file", "task.txt"]), [
    "--prompt-file",
    "task.txt",
  ]);
  assert.deepEqual(buildGrokTraceLauncherArgs(["--prompt=inspect this repository"]), [
    "--prompt=inspect this repository",
  ]);
  assert.deepEqual(buildGrokTraceLauncherArgs(["--prompt-file=task.txt"]), [
    "--prompt-file=task.txt",
  ]);

  assert.throws(() => buildGrokTraceLauncherArgs([]), /requires.*prompt/i);
  assert.throws(
    () => buildGrokTraceLauncherArgs(["--model", "grok-code-fast-1"]),
    /-p|--prompt|--prompt-file/i,
  );
});

test("grok-trace invocation is an explicit trace opt-in", async () => {
  const { buildGrokTraceEnv } = await import("../../scripts/lib/grok-trace-launcher.mjs");

  assert.deepEqual(buildGrokTraceEnv({ GROK_BIN: "custom-grok" }), {
    GROK_BIN: "custom-grok",
    GITHUB_DELIVERY_DEBUG_TRACE: "1",
  });
  assert.equal(
    buildGrokTraceEnv({ GITHUB_DELIVERY_DEBUG_TRACE: "0" }).GITHUB_DELIVERY_DEBUG_TRACE,
    "1",
  );
});
