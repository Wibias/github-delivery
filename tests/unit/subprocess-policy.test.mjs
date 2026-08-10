import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  boundedSpawnSync,
  DEFAULT_SUBPROCESS_KILL_SIGNAL,
} from "../../scripts/lib/subprocess-policy.mjs";

test("a stubborn child cannot outlive the bounded subprocess deadline", () => {
  const started = Date.now();
  const result = boundedSpawnSync(
    process.execPath,
    [
      "-e",
      "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);",
    ],
    { encoding: "utf8", timeout: 200 },
  );
  const elapsed = Date.now() - started;

  assert.equal(DEFAULT_SUBPROCESS_KILL_SIGNAL, "SIGKILL");
  assert.equal(result?.error?.code, "ETIMEDOUT");
  assert.match(String(result.stderr || ""), /subprocess_timeout/);
  assert.ok(elapsed < 5_000, `subprocess exceeded hard deadline budget: ${elapsed}ms`);
});

test("canonical mutation and GitHub retry entrypoints do not fall back to raw spawnSync", () => {
  const mutate = readFileSync(
    new URL("../../scripts/github-mutate.mjs", import.meta.url),
    "utf8",
  );
  const retry = readFileSync(
    new URL("../../scripts/lib/github-retry.mjs", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(mutate, /from\s+["']node:child_process["']/);
  assert.match(mutate, /runner:\s*boundedSpawnSync/);
  assert.doesNotMatch(retry, /from\s+["']node:child_process["']/);
  assert.match(retry, /runner\s*=\s*boundedSpawnSync/);
});
