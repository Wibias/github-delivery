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
  assert.equal(result.events.length, 6);
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
  for (const event of ["PreToolUse", "PostToolUse", "UserPromptSubmit", "Stop", "SubagentStop", "SessionEnd"]) {
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

test("apply removes duplicate watchdog commands while preserving unrelated hooks", () => {
  const f = fixture();
  const watchdog = {
    type: "command",
    command: `node "${join(f.skillDir, "scripts", "codex-watchdog-hook.mjs")}"`,
  };
  writeFileSync(
    f.hooksPath,
    JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { hooks: [watchdog, { type: "command", command: "echo keep" }] },
          { hooks: [watchdog] },
        ],
      },
    }),
  );

  const result = installCodexWatchdogHooks({
    hooksPath: f.hooksPath,
    skillDir: f.skillDir,
    apply: true,
  });
  assert.equal(result.applied, true);

  const installed = JSON.parse(readFileSync(f.hooksPath, "utf8"));
  const commands = installed.hooks.UserPromptSubmit
    .flatMap((entry) => entry.hooks || [])
    .map((entry) => entry.command || "");
  assert.equal(commands.filter((command) => command.includes("codex-watchdog-hook.mjs")).length, 1);
  assert.equal(commands.filter((command) => command === "echo keep").length, 1);
});

test("malformed existing hook configuration fails closed", () => {
  const f = fixture();
  writeFileSync(f.hooksPath, "{ definitely not json");
  assert.throws(
    () => installCodexWatchdogHooks({ hooksPath: f.hooksPath, skillDir: f.skillDir, apply: true }),
    /parse|json/i,
  );
});

test("hooks.json apply refuses a concurrent writer", () => {
  const f = fixture();
  writeFileSync(join(f.root, "hooks.json.lock"), "foreign-holder\n");
  assert.throws(
    () => installCodexWatchdogHooks({
      hooksPath: f.hooksPath,
      skillDir: f.skillDir,
      apply: true,
    }),
    /install_lock_held/,
  );
});

test("hooks.json apply holds the lock across the write", () => {
  const f = fixture();
  let nestedError;
  installCodexWatchdogHooks({
    hooksPath: f.hooksPath,
    skillDir: f.skillDir,
    apply: true,
    writeFile(path, data) {
      try {
        installCodexWatchdogHooks({
          hooksPath: f.hooksPath,
          skillDir: join(f.root, "other-skill"),
          apply: true,
        });
      } catch (error) {
        nestedError = error;
      }
      writeFileSync(path, data);
    },
  });
  assert.match(String(nestedError?.message || nestedError), /install_lock_held/);
});
