#!/usr/bin/env node
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { installCodexWatchdogHooks } from "./install-codex-watchdog-hooks.mjs";
import { applyInstallation, planInstallation, restoreBackup } from "./lib/distribution.mjs";
import {
  selectWatchdogMode,
  writeActivationReceipt,
} from "./lib/watchdog-activation.mjs";

function parseBoolean(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

function defaultCodexHome() {
  return resolve(process.env.CODEX_HOME || join(homedir(), ".codex"));
}

function inferHost(codexHome) {
  return process.env.SHIPPING_GITHUB_HOST ||
    (process.env.CODEX_HOME || existsSync(codexHome) ? "codex" : "unknown");
}

export function parseInstallArgs(argv) {
  const codexHome = defaultCodexHome();
  const options = {
    source: join(process.cwd(), "dist", "github-delivery"),
    target: join(homedir(), ".agents", "skills", "github-delivery"),
    backupRoot: undefined,
    apply: false,
    allowDowngrade: false,
    force: false,
    restore: null,
    codexHome,
    host: inferHost(codexHome),
    lifecycleHooksSupported: undefined,
    hookTrustVerified: parseBoolean(process.env.SHIPPING_GITHUB_HOOK_TRUST_VERIFIED),
    streamLaunchControlled: parseBoolean(
      process.env.SHIPPING_GITHUB_STREAM_LAUNCH_CONTROLLED,
    ),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source") options.source = argv[++index];
    else if (arg === "--target") options.target = argv[++index];
    else if (arg === "--backup-root") options.backupRoot = argv[++index];
    else if (arg === "--restore") options.restore = argv[++index];
    else if (arg === "--codex-home") options.codexHome = argv[++index];
    else if (arg === "--host") options.host = argv[++index];
    else if (arg === "--lifecycle-hooks-supported") options.lifecycleHooksSupported = true;
    else if (arg === "--no-lifecycle-hooks") options.lifecycleHooksSupported = false;
    else if (arg === "--hook-trust-verified") options.hookTrustVerified = true;
    else if (arg === "--stream-launch-controlled") options.streamLaunchControlled = true;
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--allow-downgrade") options.allowDowngrade = true;
    else if (arg === "--force") options.force = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  options.source = resolve(options.source);
  options.target = resolve(options.target);
  options.codexHome = resolve(options.codexHome);
  if (options.backupRoot) options.backupRoot = resolve(options.backupRoot);
  if (options.restore) options.restore = resolve(options.restore);
  if (options.lifecycleHooksSupported === undefined) {
    options.lifecycleHooksSupported = options.host === "codex";
  }
  return options;
}

function sameVersionActivationReceipt(plan) {
  return {
    schemaVersion: 1,
    kind: "github-delivery/install-receipt",
    action: "same-version",
    sourceVersion: plan.sourceVersion,
    previousVersion: plan.targetVersion,
    target: plan.target,
    backupPath: null,
    unchanged: true,
  };
}

export function installSkill(options) {
  if (options.restore) {
    return options.apply
      ? restoreBackup({ backup: options.restore, target: options.target })
      : { action: "restore", apply: false, backup: options.restore, target: options.target };
  }

  const sourceLauncherPath = join(options.source, "scripts", "codex-with-watchdog.mjs");
  const installedLauncherPath = join(options.target, "scripts", "codex-with-watchdog.mjs");
  const launcherBundled = existsSync(sourceLauncherPath);
  const streamLaunchVerified = options.streamLaunchControlled === true && launcherBundled;
  const hooksPath = join(options.codexHome, "hooks.json");

  let hookPlan = null;
  if (options.host === "codex" && options.lifecycleHooksSupported) {
    hookPlan = installCodexWatchdogHooks({
      hooksPath,
      skillDir: options.target,
      apply: false,
    });
  }

  const installationPlan = planInstallation(options);
  const activationRefreshRequested =
    options.hookTrustVerified === true || options.streamLaunchControlled === true;
  let installation;
  if (!options.apply) {
    installation = { ...installationPlan, apply: false };
  } else if (installationPlan.action === "same-version" && activationRefreshRequested) {
    installation = sameVersionActivationReceipt(installationPlan);
  } else {
    installation = applyInstallation(options);
  }

  if (options.apply && launcherBundled && !existsSync(installedLauncherPath)) {
    throw new Error("protected Codex launcher was not installed with the skill payload");
  }

  let hookResult = hookPlan;
  if (options.apply && hookPlan) {
    hookResult = installCodexWatchdogHooks({
      hooksPath,
      skillDir: options.target,
      apply: true,
    });
  }

  const hooksConfigured = Boolean(hookPlan);
  const hookDefinitionChanged = Boolean(hookPlan?.wouldChange || hookResult?.applied);
  const hookTrustVerified = Boolean(
    hooksConfigured && options.hookTrustVerified === true && !hookDefinitionChanged,
  );

  const selection = selectWatchdogMode({
    host: options.host,
    streamLaunchControlled: streamLaunchVerified,
    lifecycleHooksSupported: options.lifecycleHooksSupported,
    hookTrustVerified,
  });
  if (options.streamLaunchControlled && !launcherBundled && selection.mode !== "stream") {
    selection.degradationReason = "stream_launcher_unavailable";
  }

  const launcherPath = selection.mode === "stream" ? installedLauncherPath : null;
  const receiptResult = writeActivationReceipt({
    codexHome: options.codexHome,
    mode: selection.mode,
    degradationReason: selection.degradationReason,
    launcherPath,
    hooksConfigured,
    hookTrustVerified,
    apply: options.apply,
  });

  return {
    ...installation,
    watchdog: {
      mode: selection.mode,
      degradationReason: selection.degradationReason,
      receiptPath: receiptResult.path,
      receiptChanged: receiptResult.changed,
      hooksConfigured,
      hookTrustVerified,
      hookTrustRequired: hooksConfigured && !hookTrustVerified,
      hookResult,
      launcherPath,
      streamLauncherPath: launcherBundled ? installedLauncherPath : null,
    },
  };
}

export function main(argv = process.argv.slice(2)) {
  const options = parseInstallArgs(argv);
  const result = installSkill(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: String(error?.message || error) }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
