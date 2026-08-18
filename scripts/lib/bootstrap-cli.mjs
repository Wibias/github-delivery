import { boundedSpawnSync } from "./subprocess-policy.mjs";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const PUBLIC_COMMANDS = new Set(["install", "setup", "start", "autostart", "update", "doctor"]);
const SUPPORTED_NODE_MAJORS = new Set([22, 24, 26]);
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

function fail(code) {
  throw new Error(code);
}

function cleanDetail(value, fallback) {
  const detail = String(value || "").trim();
  return detail || fallback;
}

function runProbe(spawn, program, args) {
  try {
    const result = spawn(program, args, {
      encoding: "utf8",
      windowsHide: true,
      shell: false,
    });
    const ok = result?.status === 0 && !result?.error;
    return {
      ok,
      detail: cleanDetail(
        result?.stdout || result?.stderr || result?.error?.message,
        ok ? `${program} available` : `${program} unavailable`,
      ),
    };
  } catch (error) {
    return { ok: false, detail: cleanDetail(error?.message, `${program} unavailable`) };
  }
}

function parseInstalledManifest(raw) {
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    !manifest
    || typeof manifest !== "object"
    || Array.isArray(manifest)
    || manifest.schemaVersion !== 1
    || manifest.kind !== "github-delivery/distribution-manifest"
    || manifest.name !== "github-delivery"
    || !VERSION_PATTERN.test(manifest.version || "")
  ) {
    return null;
  }
  return manifest;
}

function skillFrontmatterNamesGitHubDelivery(raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(String(raw || ""));
  return Boolean(match && /^name:\s*github-delivery\s*$/m.test(match[1]));
}

export function inspectLegacyManifestlessInstallation({
  target,
  exists = existsSync,
  readFile = readFileSync,
} = {}) {
  if (!target) return null;
  target = resolve(target);
  if (exists(join(target, "manifest.json"))) return null;

  const packagePath = join(target, "package.json");
  const skillPath = join(target, "SKILL.md");
  const installerPath = join(target, "scripts", "install-skill.mjs");
  if (!exists(packagePath) || !exists(skillPath) || !exists(installerPath)) return null;

  let packageJson;
  let skill;
  try {
    packageJson = JSON.parse(readFile(packagePath, "utf8"));
    skill = readFile(skillPath, "utf8");
  } catch {
    return null;
  }

  if (
    !packageJson
    || typeof packageJson !== "object"
    || Array.isArray(packageJson)
    || packageJson.name !== "github-delivery"
    || !VERSION_PATTERN.test(packageJson.version || "")
    || !skillFrontmatterNamesGitHubDelivery(skill)
  ) {
    return null;
  }

  return { target, version: packageJson.version };
}

export function parseBootstrapArgs(argv = []) {
  const values = [...argv];
  let command = "guided";
  let apply = false;
  let target = null;
  let help = false;
  let json = false;
  let autostartMode = null;
  let index = 0;

  if (values[0] === "help" || values[0] === "--help" || values[0] === "-h") {
    return { command, apply, target, help: true };
  }

  if (values[0] && !values[0].startsWith("-")) {
    command = values[0];
    index = 1;
    if (!PUBLIC_COMMANDS.has(command)) fail("bootstrap_command_unknown");
  }

  if (command === "autostart") {
    autostartMode = "on";
    if (values[index] && !values[index].startsWith("-")) {
      if (!["on", "off", "status"].includes(values[index])) fail("bootstrap_autostart_mode_invalid");
      autostartMode = values[index];
      index += 1;
    }
  }

  for (; index < values.length; index += 1) {
    const arg = values[index];
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--apply") {
      if (command !== "update") fail("bootstrap_apply_update_only");
      apply = true;
    } else if (arg === "--json") {
      if (command !== "doctor") fail("bootstrap_json_doctor_only");
      json = true;
    } else if (arg === "--target") {
      const value = values[++index];
      if (!value || value.startsWith("--")) fail("bootstrap_target_missing");
      target = resolve(value);
    } else {
      fail("bootstrap_option_unknown");
    }
  }

  const result = { command, apply, target, help };
  if (json) result.json = true;
  if (autostartMode) result.autostartMode = autostartMode;
  return result;
}

export function checkBootstrapEnvironment({
  nodeVersion = process.version,
  spawn = boundedSpawnSync,
} = {}) {
  const version = String(nodeVersion || "").replace(/^v/, "");
  const major = Number(version.split(".")[0]);
  const node = { ok: SUPPORTED_NODE_MAJORS.has(major), version };
  const git = runProbe(spawn, "git", ["--version"]);
  const gh = runProbe(spawn, "gh", ["--version"]);
  const ghAuth = gh.ok
    ? runProbe(spawn, "gh", ["auth", "status"])
    : { ok: false, detail: "gh unavailable" };

  return {
    ok: node.ok && git.ok && gh.ok && ghAuth.ok,
    node,
    git,
    gh,
    ghAuth,
  };
}

export function discoverInstallations({
  home = homedir(),
  explicitTarget = null,
  exists = existsSync,
  readFile = readFileSync,
} = {}) {
  const candidates = explicitTarget
    ? [resolve(explicitTarget)]
    : [
        join(resolve(home), ".agents", "skills", "github-delivery"),
        join(resolve(home), ".codex", "skills", "github-delivery"),
        join(resolve(home), ".claude", "skills", "github-delivery"),
        join(resolve(home), ".cursor", "skills", "github-delivery"),
      ];

  const seen = new Set();
  const installations = [];
  for (const candidate of candidates) {
    const target = resolve(candidate);
    if (seen.has(target)) continue;
    seen.add(target);

    const manifestPath = join(target, "manifest.json");
    if (!exists(manifestPath)) {
      const legacy = inspectLegacyManifestlessInstallation({ target, exists, readFile });
      if (legacy) {
        installations.push({
          target,
          valid: false,
          migratable: true,
          legacy: true,
          version: legacy.version,
          reason: "legacy_manifestless",
        });
      } else if (explicitTarget) {
        installations.push({ target, valid: false, version: null, reason: "missing_manifest" });
      }
      continue;
    }

    let manifest = null;
    try {
      manifest = parseInstalledManifest(readFile(manifestPath, "utf8"));
    } catch {
      manifest = null;
    }
    installations.push(manifest
      ? { target, valid: true, version: manifest.version, reason: null }
      : { target, valid: false, version: null, reason: "invalid_manifest" });
  }
  return installations;
}
