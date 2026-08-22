#!/usr/bin/env node
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";

import { installCodexWatchdogHooks } from "./install-codex-watchdog-hooks.mjs";
import { applyInstallation, planInstallation, restoreBackup } from "./lib/distribution.mjs";
import {
  planAuthorityHostUpdate,
  readInstalledAuthorityHost,
  reconcileStableAuthorityHost,
} from "./lib/authority-host-install.mjs";
import { prepareVerifiedReleaseCandidate } from "./lib/release-self-update.mjs";
import {
  compareInstalledManifest,
  readInstalledManifest,
} from "./lib/stable-release-update.mjs";
import { readUserConfig, resolveAuthorityMode } from "./lib/user-config.mjs";
import {
  readActivationReceipt,
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

export function parseInstallArgs(argv, { installedRoot = resolve(import.meta.dirname, "..") } = {}) {
  const codexHome = defaultCodexHome();
  const options = {
    source: join(installedRoot, "dist", "github-delivery"),
    target: join(homedir(), ".agents", "skills", "github-delivery"),
    backupRoot: undefined,
    apply: false,
    update: false,
    sourceExplicit: false,
    targetExplicit: false,
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
    if (arg === "--source") {
      options.source = argv[++index];
      options.sourceExplicit = true;
    } else if (arg === "--target") {
      options.target = argv[++index];
      options.targetExplicit = true;
    } else if (arg === "--backup-root") options.backupRoot = argv[++index];
    else if (arg === "--restore") options.restore = argv[++index];
    else if (arg === "--codex-home") options.codexHome = argv[++index];
    else if (arg === "--host") options.host = argv[++index];
    else if (arg === "--lifecycle-hooks-supported") options.lifecycleHooksSupported = true;
    else if (arg === "--no-lifecycle-hooks") options.lifecycleHooksSupported = false;
    else if (arg === "--hook-trust-verified") options.hookTrustVerified = true;
    else if (arg === "--stream-launch-controlled") options.streamLaunchControlled = true;
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--update") options.update = true;
    else if (arg === "--allow-downgrade") options.allowDowngrade = true;
    else if (arg === "--force") options.force = true;
    else throw new Error(`unknown argument: ${arg}`);
  }

  if (options.update) {
    if (options.sourceExplicit) throw new Error("update_source_conflict");
    if (options.restore) throw new Error("update_restore_conflict");
    if (options.allowDowngrade) throw new Error("update_allow_downgrade_forbidden");
    if (!options.targetExplicit) options.target = installedRoot;
  }

  if (!options.sourceExplicit) {
    const packaged = resolve(installedRoot, "dist", "github-delivery");
    const bundleRoot = resolve(installedRoot);
    options.source = existsSync(join(packaged, "package.json"))
      ? packaged
      : existsSync(join(bundleRoot, "package.json"))
        ? bundleRoot
        : packaged;
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
  const previousActivation = readActivationReceipt({ codexHome: options.codexHome });

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
  const previousHookTrustVerified = Boolean(
    previousActivation?.hooksConfigured === true && previousActivation?.hookTrustVerified === true,
  );
  const hookTrustVerified = Boolean(
    hooksConfigured
      && !hookDefinitionChanged
      && (options.hookTrustVerified === true || previousHookTrustVerified),
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

function makeReleaseUpdateWorkspace() {
  return mkdtempSync(join(tmpdir(), "github-delivery-release-update-"));
}

function removeReleaseUpdateWorkspace(workspace) {
  rmSync(workspace, { recursive: true, force: true });
}

function verifyInstalledRelease({ target, manifest }) {
  const installedManifest = readInstalledManifest(target);
  if (!isDeepStrictEqual(installedManifest, manifest)) {
    throw new Error("stable_release_postinstall_manifest_mismatch");
  }
  const comparison = compareInstalledManifest({ manifest, target });
  if (!comparison.clean) {
    throw new Error("stable_release_postinstall_verification_failed");
  }
  return comparison;
}

function sameUserConfig(before, after) {
  return isDeepStrictEqual(before?.config, after?.config);
}

function planAuthorityForRelease(candidate, dependencies = {}) {
  const readConfig = dependencies.readUserConfig || readUserConfig;
  const readAuthority = dependencies.readInstalledAuthorityHost || readInstalledAuthorityHost;
  const planAuthority = dependencies.planAuthorityHostUpdate || planAuthorityHostUpdate;
  const installed = readAuthority();
  if (!installed?.supported) {
    return planAuthority({
      mode: "off",
      targetVersion: candidate.release.version,
      installed,
    });
  }
  const config = readConfig();
  const mode = resolveAuthorityMode({ config: config.config, env: process.env });
  return planAuthority({
    mode,
    targetVersion: candidate.release.version,
    installed,
  });
}

export async function runInstallCommand(options, dependencies = {}) {
  const install = dependencies.installSkill || installSkill;
  if (!options.update) return install(options);

  const prepareCandidate = dependencies.prepareVerifiedReleaseCandidate || prepareVerifiedReleaseCandidate;
  const makeWorkspace = dependencies.makeWorkspace || makeReleaseUpdateWorkspace;
  const removeWorkspace = dependencies.removeWorkspace || removeReleaseUpdateWorkspace;
  const readConfig = dependencies.readUserConfig || readUserConfig;
  const verifyRelease = dependencies.verifyInstalledRelease || verifyInstalledRelease;
  const reconcileAuthority = dependencies.reconcileStableAuthorityHost || reconcileStableAuthorityHost;
  const progress = typeof dependencies.onProgress === "function" ? dependencies.onProgress : () => {};
  const workspace = makeWorkspace();
  let installation = null;

  try {
    if (options.apply) progress({ stage: "checking_release" });
    const candidate = await prepareCandidate({
      target: options.target,
      workspace,
    });
    if (!candidate?.verified || !candidate?.plan || !candidate?.release || !candidate?.manifest || !candidate?.source) {
      throw new Error("stable_release_candidate_invalid");
    }
    if (options.apply) progress({ stage: "release_verified", version: candidate.release.version });

    if (candidate.plan.action === "already_ahead") {
      return {
        ...candidate.plan,
        apply: Boolean(options.apply),
        updated: false,
        verified: true,
        release: candidate.release,
        authorityHost: { action: "skipped_skill_ahead", changed: false },
      };
    }

    const authorityPlan = planAuthorityForRelease(candidate, dependencies);
    if (!options.apply) {
      return {
        ...candidate.plan,
        apply: false,
        updated: false,
        verified: true,
        release: candidate.release,
        authorityHost: authorityPlan,
      };
    }

    if (candidate.plan.action === "already_current") {
      if (authorityPlan?.required === true) {
        progress({
          stage: "updating_authority",
          currentVersion: authorityPlan.currentVersion,
          targetVersion: authorityPlan.targetVersion,
        });
      }
      const authorityHost = await reconcileAuthority({
        expectedRelease: candidate.release,
        scriptPath: join(options.target, "authority-host", "windows", "install-release.ps1"),
      });
      const authorityUpdated = authorityHost?.changed === true;
      if (authorityUpdated) {
        progress({ stage: "authority_updated", version: authorityHost?.installed?.version || candidate.release.version });
      }
      return {
        ...candidate.plan,
        action: authorityUpdated ? "update" : candidate.plan.action,
        apply: true,
        updated: authorityUpdated,
        verified: true,
        release: candidate.release,
        authorityHost,
      };
    }

    const legacyMigration = candidate.plan.action === "migrate_legacy"
      && candidate.plan.legacyManifestless === true
      && candidate.plan.migrationAllowed === true;
    if (!legacyMigration && (candidate.plan.action !== "update" || candidate.plan.safeToReplace !== true)) {
      throw new Error(`stable_release_update_blocked:${candidate.plan.action || "invalid"}`);
    }

    const configBefore = readConfig();
    progress({
      stage: "installing_skill",
      currentVersion: candidate.plan.currentVersion,
      targetVersion: candidate.release.version,
    });
    installation = install({
      ...options,
      source: candidate.source,
      update: false,
      apply: true,
      allowDowngrade: false,
      force: false,
      legacyManifestlessMigration: legacyMigration,
    });
    progress({ stage: "skill_installed", backupPath: installation?.backupPath || null });

    verifyRelease({ target: options.target, manifest: candidate.manifest });
    const configAfter = readConfig();
    if (!sameUserConfig(configBefore, configAfter)) {
      throw new Error("stable_update_user_config_changed_unexpectedly");
    }
    progress({ stage: "skill_verified", version: candidate.release.version });

    if (authorityPlan?.required === true) {
      progress({
        stage: "updating_authority",
        currentVersion: authorityPlan.currentVersion,
        targetVersion: authorityPlan.targetVersion,
      });
    }
    let authorityHost;
    try {
      authorityHost = await reconcileAuthority({
        expectedRelease: candidate.release,
        scriptPath: join(options.target, "authority-host", "windows", "install-release.ps1"),
      });
    } catch (error) {
      if (installation?.backupPath) {
        const restore = dependencies.restoreBackup || restoreBackup;
        try {
          restore({ backup: installation.backupPath, target: options.target });
          if (error && typeof error === "object") error.rolledBack = true;
        } catch {
          // Keep the Authority error; backupPath is still attached below.
        }
      }
      throw error;
    }
    if (authorityHost?.changed === true) {
      progress({ stage: "authority_updated", version: authorityHost?.installed?.version || candidate.release.version });
    }

    return {
      action: legacyMigration ? "migrate_legacy" : "update",
      apply: true,
      updated: true,
      verified: true,
      previousVersion: candidate.plan.currentVersion,
      sourceVersion: candidate.release.version,
      target: options.target,
      backupPath: installation?.backupPath || null,
      release: candidate.release,
      watchdog: installation?.watchdog || null,
      authorityHost,
    };
  } catch (error) {
    if (installation?.backupPath && error && typeof error === "object") {
      error.backupPath = installation.backupPath;
    }
    throw error;
  } finally {
    removeWorkspace(workspace);
  }
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseInstallArgs(argv);
  const result = await runInstallCommand(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      error: String(error?.message || error),
      ...(error?.backupPath ? { backupPath: error.backupPath } : {}),
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
