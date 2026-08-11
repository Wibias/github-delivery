import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "../..");
const INSTALL = join(ROOT, "scripts", "install-skill.mjs");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "gd-watchdog-activation-"));
  const source = join(root, "source");
  const target = join(root, "skills", "github-delivery");
  const codexHome = join(root, ".codex");
  mkdirSync(join(source, "scripts"), { recursive: true });
  writeFileSync(
    join(source, "package.json"),
    `${JSON.stringify({ name: "github-delivery", version: "0.2.0" }, null, 2)}\n`,
  );
  writeFileSync(join(source, "marker.txt"), "installed\n");
  writeFileSync(join(source, "scripts", "codex-watchdog-hook.mjs"), "// hook fixture\n");
  writeFileSync(join(source, "scripts", "codex-with-watchdog.mjs"), "// launcher fixture\n");
  return { root, source, target, codexHome };
}

function runInstall(f, extra = []) {
  return spawnSync(
    process.execPath,
    [
      INSTALL,
      "--source",
      f.source,
      "--target",
      f.target,
      "--codex-home",
      f.codexHome,
      "--host",
      "codex",
      ...extra,
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
}

test("normal Codex install activates lifecycle watchdog without a second installer", () => {
  const f = fixture();
  const result = runInstall(f, ["--lifecycle-hooks-supported", "--apply"]);
  assert.equal(result.status, 0, result.stderr);

  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.watchdog.mode, "hooks");
  assert.equal(receipt.watchdog.degradationReason, "streaming_interruption_unavailable");
  assert.equal(readFileSync(join(f.target, "marker.txt"), "utf8"), "installed\n");

  const hooksPath = join(f.codexHome, "hooks.json");
  const hooks = JSON.parse(readFileSync(hooksPath, "utf8"));
  for (const event of ["PreToolUse", "PostToolUse", "Stop", "SubagentStop", "SessionEnd"]) {
    const commands = (hooks.hooks[event] || [])
      .flatMap((entry) => entry.hooks || [])
      .map((entry) => entry.command || "");
    assert.equal(commands.filter((command) => command.includes("codex-watchdog-hook.mjs")).length, 1);
  }

  assert.equal(existsSync(join(f.codexHome, "github-delivery", "watchdog-activation.json")), true);
  assert.equal(
    receipt.watchdog.streamLauncherPath,
    join(f.target, "scripts", "codex-with-watchdog.mjs"),
  );
});

test("stream mode is selected only when the installed launch boundary is explicitly controllable", () => {
  const f = fixture();
  const withoutBoundary = runInstall(f, ["--lifecycle-hooks-supported"]);
  assert.equal(withoutBoundary.status, 0, withoutBoundary.stderr);
  assert.equal(JSON.parse(withoutBoundary.stdout).watchdog.mode, "hooks");

  const withBoundary = runInstall(f, [
    "--lifecycle-hooks-supported",
    "--stream-launch-controlled",
  ]);
  assert.equal(withBoundary.status, 0, withBoundary.stderr);
  const result = JSON.parse(withBoundary.stdout);
  assert.equal(result.watchdog.mode, "stream");
  assert.equal(result.watchdog.launcherPath, join(f.target, "scripts", "codex-with-watchdog.mjs"));
});

test("unsupported hosts report watchdog unavailability without blocking skill installation", () => {
  const f = fixture();
  const result = spawnSync(
    process.execPath,
    [
      INSTALL,
      "--source",
      f.source,
      "--target",
      f.target,
      "--codex-home",
      f.codexHome,
      "--host",
      "unknown",
      "--apply",
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.watchdog.mode, "none");
  assert.equal(receipt.watchdog.degradationReason, "progress_watchdog_unavailable");
  assert.equal(readFileSync(join(f.target, "marker.txt"), "utf8"), "installed\n");
});
