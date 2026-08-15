#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseBootstrapArgs } from "./lib/bootstrap-cli.mjs";
import { runBootstrap } from "./lib/bootstrap-command.mjs";

export const HELP_TEXT = `GitHub Delivery\n\nUsage:\n  github-delivery\n  github-delivery install [--target PATH]\n  github-delivery setup [--target PATH]\n  github-delivery start\n  github-delivery autostart\n  github-delivery doctor [--target PATH] [--json]\n  github-delivery update [--target PATH] [--apply]\n\nBare invocation launches guided setup.\nDoctor is human-readable by default; add --json for the raw machine report.\nUpdate is dry-run by default; add --apply only after reviewing the plan.\n`;

function value(value, fallback = "unknown") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function normalizeWatchdogMode(value) {
  const normalized = String(value || "none").toLowerCase();
  return ["stream", "hooks"].includes(normalized) ? normalized : "none";
}

function watchdogModeFromResult(value) {
  if (typeof value === "string") return normalizeWatchdogMode(value);
  return normalizeWatchdogMode(value?.mode);
}

function loopProtectionLabel(mode) {
  if (mode === "stream") return "Full (STREAM)";
  if (mode === "hooks") return "Partial (HOOKS)";
  return "Off (NONE)";
}

function renderLoopProtection(mode, stdout, { includeInFlight = false } = {}) {
  const normalized = normalizeWatchdogMode(mode);
  stdout.write(`  Agent loops  ${loopProtectionLabel(normalized)}\n`);
  if (includeInFlight) {
    stdout.write(`  In-flight    ${normalized === "stream" ? "interrupt enabled" : "not available"}\n`);
  }
}

function renderDoctor(result, stdout) {
  const environment = result?.environment || {};
  const activation = result?.activation || {};
  const authority = result?.authorityHost || {};
  const installedVersion = result?.installed?.version || "not installed";
  const latestVersion = result?.latest?.version || "unknown";
  const integrity = result?.integrity?.ok
    ? (result.integrity.clean ? "Clean" : "Modified")
    : "Unknown";
  const legacyManifestless = result?.installed?.legacyManifestless === true;
  const activationMode = normalizeWatchdogMode(activation?.mode);

  stdout.write("GitHub Delivery Doctor\n\n");
  stdout.write("Skill\n");
  stdout.write(`  Version      ${installedVersion}\n`);
  stdout.write(`  Latest       ${latestVersion}${result?.latest?.relation ? ` (${result.latest.relation})` : ""}\n`);
  stdout.write(`  Integrity    ${integrity}\n`);
  if (result?.target) stdout.write(`  Target       ${result.target}\n`);
  if (legacyManifestless) {
    stdout.write("  Legacy       manifest missing; previous file integrity is unknown\n");
    if (["update", "already_current"].includes(result?.latest?.relation)) {
      stdout.write("  Migration    available: npx github-delivery update --apply\n");
    }
  }

  stdout.write("\nEnvironment\n");
  const nodeVersion = value(environment?.node?.version);
  stdout.write(environment?.node?.ok
    ? `  Node         OK ${nodeVersion}\n`
    : `  Node         ERROR ${nodeVersion} (not supported; supported majors: 22, 24, 26)\n`);
  stdout.write(`  Git          ${environment?.git?.ok ? "OK" : "ERROR"}\n`);
  stdout.write(`  GitHub CLI   ${environment?.gh?.ok ? "OK" : "ERROR"}\n`);
  stdout.write(`  GitHub auth  ${environment?.ghAuth?.ok ? "OK" : "ERROR"}\n`);

  stdout.write("\nRuntime protection\n");
  renderLoopProtection(activationMode, stdout, { includeInFlight: true });
  stdout.write(`  Mode         ${activationMode}\n`);
  stdout.write(`  Hooks        ${activation?.hooksConfigured ? "configured" : "not configured"}\n`);
  stdout.write(`  Hook trust   ${activation?.hookTrustVerified ? "verified" : "not verified"}\n`);
  if (activationMode === "stream") {
    stdout.write("  Loop interruption ACTIVE (protected stream)\n");
  } else if (activationMode === "hooks") {
    stdout.write("  Hooks are active; streaming loop interruption is not active.\n");
  } else {
    stdout.write("  LOOP INTERRUPTION NOT ACTIVE\n");
    if (activation?.degradationReason) {
      stdout.write(`  Reason       ${activation.degradationReason}\n`);
    }
  }

  if (authority && Object.keys(authority).length > 0) {
    stdout.write("\nDelivery Authority\n");
    if (authority.supported === false) {
      stdout.write(`  Status       unsupported${authority.requiredByMode ? " (required by protection mode)" : ""}\n`);
    } else if (!authority.installed) {
      stdout.write(`  Status       not installed${authority.requiredByMode ? " (required)" : ""}\n`);
    } else {
      stdout.write(`  Version      ${value(authority.version, authority.legacy ? "legacy" : "unknown")}\n`);
      stdout.write(`  Relation     ${value(authority.relation)}\n`);
    }
  }

  const hookTrustRequired = activation?.degradationReason === "hook_trust_required"
    || (activation?.hooksConfigured === true && activation?.hookTrustVerified !== true);
  if (activationMode === "none" && hookTrustRequired) {
    stdout.write("\nAction required\n");
    stdout.write("  GitHub Delivery has not verified Codex hook trust for this installation.\n");
    stdout.write("  If these exact hooks are already trusted in Codex, they do not need to be trusted again.\n");
    stdout.write("  1. If needed, open /hooks in Codex and review/trust the GitHub Delivery hooks.\n");
    stdout.write("  2. Run: npx github-delivery setup\n");
  }

  if (environment?.ok === false) {
    stdout.write("\nEnvironment action required\n");
    stdout.write("  Fix the ERROR prerequisites above before relying on GitHub Delivery.\n");
  }
}

function updateTargetVersion(result) {
  return result?.sourceVersion
    || result?.release?.version
    || result?.assets?.version
    || result?.authorityHost?.targetVersion
    || "unknown";
}

function renderUpdateProgress(event, stdout) {
  if (!event || typeof event !== "object") return;
  if (event.stage === "checking_release") {
    stdout.write("Checking latest stable release...\n");
  } else if (event.stage === "release_verified") {
    stdout.write(`Verified release v${value(event.version)}.\n`);
  } else if (event.stage === "installing_skill") {
    stdout.write(`Updating skill ${value(event.currentVersion)} -> ${value(event.targetVersion)}...\n`);
  } else if (event.stage === "skill_installed") {
    stdout.write(event.backupPath
      ? `Skill files installed. Backup: ${event.backupPath}\n`
      : "Skill files installed.\n");
  } else if (event.stage === "skill_verified") {
    stdout.write("Skill installation verified.\n");
  } else if (event.stage === "updating_authority") {
    stdout.write(`Updating Windows approval GUI ${value(event.currentVersion, "not installed")} -> ${value(event.targetVersion)}...\n`);
  } else if (event.stage === "authority_updated") {
    stdout.write(`Windows approval GUI is ready at v${value(event.version)}.\n`);
  }
}

function renderUpdateResult(result, stdout) {
  const currentVersion = result?.previousVersion || result?.currentVersion || "unknown";
  const targetVersion = updateTargetVersion(result);
  const authority = result?.authorityHost || {};

  if (result?.apply !== true) {
    stdout.write("\nGitHub Delivery update plan\n");
    stdout.write(`  Skill        ${currentVersion} -> ${targetVersion}\n`);
    if (authority?.targetVersion) {
      stdout.write(`  Authority    ${value(authority.currentVersion, "not installed")} -> ${authority.targetVersion}\n`);
    }
    if (result?.action === "already_current" && authority?.required !== true) {
      stdout.write("No update is required.\n");
    } else if (result?.action === "already_ahead") {
      stdout.write("The installed skill is newer than the latest stable release; no update will be applied.\n");
    } else if (result?.action === "blocked_local_modifications") {
      stdout.write("Update is blocked because the managed installation has local modifications.\n");
    } else {
      stdout.write("Run: npx github-delivery update --apply\n");
    }
    return;
  }

  if (result?.updated === true) {
    stdout.write("\nGitHub Delivery updated successfully.\n");
    if (currentVersion !== "unknown" || targetVersion !== "unknown") {
      stdout.write(`  Skill        ${currentVersion} -> ${targetVersion}\n`);
    }
    if (authority?.changed === true) {
      stdout.write(`  Authority GUI ${value(authority.currentVersion, "not installed")} -> ${value(authority.targetVersion || authority?.installed?.version)}\n`);
    }
    if (result?.backupPath) stdout.write(`  Backup       ${result.backupPath}\n`);
    return;
  }

  if (result?.action === "already_current") {
    stdout.write(`\nGitHub Delivery is already current at v${targetVersion}.\n`);
    return;
  }
  if (result?.action === "already_ahead") {
    stdout.write("\nThe installed skill is newer than the latest stable release; no update was applied.\n");
    return;
  }
  stdout.write(`\nNo update was applied (${result?.action || "unknown reason"}).\n`);
}

function renderBootstrapResult(result, stdout) {
  if (result.action === "start") {
    stdout.write(result.started && result.ready !== false
      ? "GitHub Delivery approval GUI is running and Authority is ready.\n"
      : `GitHub Delivery approval GUI was not started (${result.reason || "unknown reason"}).\n`);
    if (!result.started && result.diagnosticsPath) {
      stdout.write(`  Diagnostics: ${result.diagnosticsPath}\n`);
    }
    return;
  }
  if (result.action === "autostart") {
    stdout.write(result.configured
      ? "Windows login auto-start is enabled.\n"
      : `Windows login auto-start was not enabled (${result.reason || "unknown reason"}).\n`);
    return;
  }
  if (result.action === "install") {
    stdout.write(result.verified === false
      ? "GitHub Delivery installation did not verify.\n"
      : "GitHub Delivery installed successfully.\n");
    if (result.watchdog !== undefined) {
      renderLoopProtection(watchdogModeFromResult(result.watchdog), stdout);
    }
    if (result.authorityHost?.installed) {
      stdout.write(`  Authority GUI is installed${result.authorityHost.installed.version ? ` (${result.authorityHost.installed.version})` : ""}\n`);
      stdout.write("  Start it later with: npx github-delivery start\n");
    }
    return;
  }
  if (result.action === "setup") {
    stdout.write(result.status === "ready"
      ? "GitHub Delivery setup complete.\n"
      : "GitHub Delivery setup needs one more step.\n");
    if (result.watchdog !== undefined) {
      renderLoopProtection(watchdogModeFromResult(result.watchdog), stdout);
    }
    if (result.status === "ready") stdout.write("  Start the approval GUI with: npx github-delivery start\n");
    if (result.guidance) stdout.write(`  ${result.guidance}\n`);
    return;
  }
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function printResult(result, { stdout = process.stdout, options = {} } = {}) {
  if (!result || result.action === "help") return;
  if (result.action === "doctor" && options.json !== true) {
    renderDoctor(result, stdout);
    return;
  }
  if (options.command === "update") {
    renderUpdateResult(result, stdout);
    return;
  }
  if (["install", "setup", "start", "autostart"].includes(result.action)) {
    renderBootstrapResult(result, stdout);
    return;
  }
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function isDirectExecution(entry = process.argv[1]) {
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const parse = dependencies.parseBootstrapArgs || parseBootstrapArgs;
  const options = parse(argv);
  if (options.help) {
    (dependencies.stdout || process.stdout).write(HELP_TEXT);
    return { action: "help" };
  }
  const stdout = dependencies.stdout || process.stdout;
  const runtimeDependencies = { ...dependencies };
  if (options.command === "update" && options.apply) {
    const upstreamProgress = dependencies.onProgress;
    runtimeDependencies.onProgress = (event) => {
      if (typeof upstreamProgress === "function") upstreamProgress(event);
      renderUpdateProgress(event, stdout);
    };
  }
  const result = await (runtimeDependencies.runBootstrap || runBootstrap)(argv, runtimeDependencies);
  printResult(result, { stdout, options });
  return result;
}

if (isDirectExecution()) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 1;
  });
}
