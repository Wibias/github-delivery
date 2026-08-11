import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  installCodexWatchdogHooks,
} from "../../scripts/install-codex-watchdog-hooks.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "gd-codex-hooks-"));
  return {
    root,
    hooksPath: join(root, "hooks.json"),
    skillDir: join(root, "skill"),
  };
}

test("dry run plans watchdog hooks without touching hooks.json", () => {
  const f = fixture();
  const result = installCodexWatchdogHooks({
    hooksPath: f.hooksPath,
    skillDir: f.skillDir,
    apply: false,
  });
  assert.equal(result.applied, false);
  assert.equal(result.events.length, 5);
  assert.equal(result.backupPath, null);
  assert.equal(result.wouldChange, true);
  assert.throws(() => readFileSync(f.hooksPath, "utf8"));
});

test("apply preserves existing hooks and adds one watchdog command per event", () => {
  const f = fixture();
  writeFileSync(
    f.hooksPath,
    JSON.stringify({
      description: "existing",
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo keep" }] }],
      },
    }),
  );
  const result = installCodexWatchdogHooks({
    hooksPath: f.hooksPath,
    skillDir: f.skillDir,
    apply: true,
  });
  assert.equal(result.applied, true);
  assert.ok(result.backupPath);

  const installed = JSON.parse(readFileSync(f.hooksPath, "utf8"));
  assert.equal(installed.description, "existing");
  assert.match(JSON.stringify(installed), /echo keep/);
  for (const event of ["PreToolUse", "PostToolUse", "Stop", "SubagentStop", "SessionEnd"]) {
    const commands = (installed.hooks[event] || [])
      .flatMap((entry) => entry.hooks || [])
      .map((entry) => entry.command || "");
    assert.equal(commands.filter((command) => command.includes("codex-watchdog-hook.mjs")).length, 1);
  }
});

test("reapplying is idempotent and does not create duplicate watchdog hooks", () => {
  const f = fixture();
  installCodexWatchdogHooks({ hooksPath: f.hooksPath, skillDir: f.skillDir, apply: true });
  const second = installCodexWatchdogHooks({
    hooksPath: f.hooksPath,
    skillDir: f.skillDir,
    apply: true,
  });
  assert.equal(second.wouldChange, false);
  assert.equal(second.backupPath, null);
});

test("malformed existing hook configuration fails closed", () => {
  const f = fixture();
  writeFileSync(f.hooksPath, "{ definitely not json");
  assert.throws(
    () => installCodexWatchdogHooks({ hooksPath: f.hooksPath, skillDir: f.skillDir, apply: true }),
    /parse|json/i,
  );
});
