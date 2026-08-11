#!/usr/bin/env node
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const EVENTS = Object.freeze([
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "SubagentStop",
  "SessionEnd",
]);

function quote(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

function defaultHooksPath() {
  return join(homedir(), ".codex", "hooks.json");
}

function defaultSkillDir() {
  return join(homedir(), ".agents", "skills", "github-delivery");
}

function readExisting(path) {
  if (!existsSync(path)) return { hooks: {} };
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing to modify symlinked hooks file: ${path}`);
  }
  if (!stat.isFile()) throw new Error(`Hooks path is not a file: ${path}`);
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("root must be a JSON object");
    }
    if (value.hooks !== undefined && (!value.hooks || typeof value.hooks !== "object" || Array.isArray(value.hooks))) {
      throw new Error("hooks must be a JSON object");
    }
    return { ...value, hooks: { ...(value.hooks || {}) } };
  } catch (error) {
    throw new Error(`Could not parse existing Codex hooks JSON: ${error?.message || error}`);
  }
}

function hasWatchdog(entry) {
  return (entry?.hooks || []).some((hook) =>
    /(?:^|[\\/])codex-watchdog-hook\.mjs(?:"|\s|$)/i.test(
      String(hook?.commandWindows || hook?.command || ""),
    ),
  );
}

function watchdogEntry(skillDir) {
  const script = resolve(skillDir, "scripts", "codex-watchdog-hook.mjs");
  const command = `node ${quote(script)}`;
  return {
    hooks: [
      {
        type: "command",
        command,
        commandWindows: command,
      },
    ],
  };
}

function mergedConfig(existing, skillDir) {
  let changed = false;
  const hooks = { ...(existing.hooks || {}) };
  for (const event of EVENTS) {
    const current = hooks[event] === undefined ? [] : hooks[event];
    if (!Array.isArray(current)) {
      throw new Error(`hooks.${event} must be an array`);
    }
    if (current.some(hasWatchdog)) continue;
    hooks[event] = [...current, watchdogEntry(skillDir)];
    changed = true;
  }
  return { config: { ...existing, hooks }, changed };
}

function backupName(path) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${path}.backup-${stamp}`;
}

export function installCodexWatchdogHooks({
  hooksPath = defaultHooksPath(),
  skillDir = defaultSkillDir(),
  apply = false,
} = {}) {
  const target = resolve(hooksPath);
  const skill = resolve(skillDir);
  const existing = readExisting(target);
  const { config, changed } = mergedConfig(existing, skill);
  let backupPath = null;

  if (apply && changed) {
    mkdirSync(dirname(target), { recursive: true });
    if (existsSync(target)) {
      backupPath = backupName(target);
      copyFileSync(target, backupPath);
    }
    writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }

  return {
    schemaVersion: 1,
    hooksPath: target,
    skillDir: skill,
    events: [...EVENTS],
    wouldChange: changed,
    applied: apply && changed,
    backupPath,
  };
}

function parseArgs(argv) {
  let apply = false;
  let hooksPath;
  let skillDir;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") apply = true;
    else if (arg === "--hooks") {
      hooksPath = argv[++index];
      if (!hooksPath) throw new Error("--hooks requires a path");
    } else if (arg === "--skill-dir") {
      skillDir = argv[++index];
      if (!skillDir) throw new Error("--skill-dir requires a path");
    } else {
      throw new Error(
        `Unknown option: ${arg}\nUsage: node scripts/install-codex-watchdog-hooks.mjs [--apply] [--hooks PATH] [--skill-dir PATH]`,
      );
    }
  }
  return { apply, hooksPath, skillDir };
}

export function main({ argv = process.argv.slice(2), stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const args = parseArgs(argv);
    const result = installCodexWatchdogHooks(args);
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    stderr.write(`${error?.message || error}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
