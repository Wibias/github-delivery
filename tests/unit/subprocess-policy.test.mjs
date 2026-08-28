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

test("direct spawn rejects a reconstructed shell and copies argv off the caller array", () => {
  const calls = [];
  const args = ["--repo", "Wibias/github-delivery"];
  boundedSpawnSync("gh", args, { shell: true, encoding: "utf8" }, {
    platform: "linux",
    spawn(command, argv, options) {
      calls.push({ command, argv, options });
      return { status: 0, stdout: "", stderr: "" };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "gh");
  assert.deepEqual(calls[0].argv, ["--repo", "Wibias/github-delivery"]);
  assert.notEqual(calls[0].argv, args);
  assert.equal(calls[0].options.shell, false);
  assert.throws(
    () => boundedSpawnSync("gh", ["ok", 1], {}, { platform: "linux", spawn() { throw new Error("must not spawn"); } }),
    /subprocess_arg_invalid:1/,
  );
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

test("remaining GitHub and Git helper entrypoints do not fall back to raw spawnSync", () => {
  const files = [
    "scripts/actions-ship-gate-snapshot.mjs",
    "scripts/capability-inventory.mjs",
    "scripts/check-syntax.mjs",
    "scripts/ci-forensics.mjs",
    "scripts/cleanup-live-github-fixture.mjs",
    "scripts/github-authorize.mjs",
    "scripts/lib/authority-host-install.mjs",
    "scripts/lib/bootstrap-cli.mjs",
    "scripts/lib/release-self-update.mjs",
    "scripts/lib/review-scope.mjs",
    "scripts/lib/verdict-publication.mjs",
    "scripts/live-github-fixture.mjs",
    "scripts/publish-npm-idempotent.mjs",
    "scripts/runtime-capabilities.mjs",
    "scripts/validate-npm-package.mjs",
    "scripts/verify-existing-release.mjs",
    "scripts/verify-live-fixture-token.mjs",
    "scripts/verify-live-repository-policy.mjs",
    "scripts/verify-pr-head.mjs",
    "scripts/verify-verdict-published.mjs",
  ];

  for (const relative of files) {
    const source = readFileSync(new URL(`../../${relative}`, import.meta.url), "utf8");
    assert.doesNotMatch(
      source,
      /import\s*\{[^}]*\bspawnSync\b[^}]*\}\s*from\s*["']node:child_process["']/,
      relative,
    );
    assert.match(source, /boundedSpawnSync/, relative);
  }
});
