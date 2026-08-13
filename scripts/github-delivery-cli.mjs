#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseBootstrapArgs } from "./lib/bootstrap-cli.mjs";
import { runBootstrap } from "./lib/bootstrap-command.mjs";

export const HELP_TEXT = `GitHub Delivery\n\nUsage:\n  github-delivery\n  github-delivery install [--target PATH]\n  github-delivery setup [--target PATH]\n  github-delivery doctor [--target PATH] [--json]\n  github-delivery update [--target PATH] [--apply]\n\nBare invocation launches guided setup.\nDoctor is human-readable by default; add --json for the raw machine report.\nUpdate is dry-run by default; add --apply only after reviewing the plan.\n`;

function value(value, fallback = "unknown") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
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

  stdout.write("GitHub Delivery Doctor\n\n");
  stdout.write("Skill\n");
  stdout.write(`  Version      ${installedVersion}\n`);
  stdout.write(`  Latest       ${latestVersion}${result?.latest?.relation ? ` (${result.latest.relation})` : ""}\n`);
  stdout.write(`  Integrity    ${integrity}\n`);
  if (result?.target) stdout.write(`  Target       ${result.target}\n`);

  stdout.write("\nEnvironment\n");
  const nodeVersion = value(environment?.node?.version);
  stdout.write(environment?.node?.ok
    ? `  Node         OK ${nodeVersion}\n`
    : `  Node         ERROR ${nodeVersion} (not supported; supported majors: 22, 24, 26)\n`);
  stdout.write(`  Git          ${environment?.git?.ok ? "OK" : "ERROR"}\n`);
  stdout.write(`  GitHub CLI   ${environment?.gh?.ok ? "OK" : "ERROR"}\n`);
  stdout.write(`  GitHub auth  ${environment?.ghAuth?.ok ? "OK" : "ERROR"}\n`);

  stdout.write("\nRuntime protection\n");
  stdout.write(`  Mode         ${value(activation?.mode, "none")}\n`);
  stdout.write(`  Hooks        ${activation?.hooksConfigured ? "configured" : "not configured"}\n`);
  stdout.write(`  Hook trust   ${activation?.hookTrustVerified ? "verified" : "not verified"}\n`);
  if (activation?.mode === "stream") {
    stdout.write("  Loop interruption ACTIVE (protected stream)\n");
  } else if (activation?.mode === "hooks") {
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
  if (activation?.mode === "none" && hookTrustRequired) {
    stdout.write("\nAction required\n");
    stdout.write("  1. Open /hooks in Codex and review/trust the GitHub Delivery hooks.\n");
    stdout.write("  2. Run: npx github-delivery setup\n");
  }

  if (environment?.ok === false) {
    stdout.write("\nEnvironment action required\n");
    stdout.write("  Fix the ERROR prerequisites above before relying on GitHub Delivery.\n");
  }
}

function printResult(result, { stdout = process.stdout, options = {} } = {}) {
  if (!result || result.action === "help") return;
  if (result.action === "doctor" && options.json !== true) {
    renderDoctor(result, stdout);
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
  const result = await (dependencies.runBootstrap || runBootstrap)(argv, dependencies);
  printResult(result, { stdout: dependencies.stdout || process.stdout, options });
  return result;
}

if (isDirectExecution()) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 1;
  });
}
