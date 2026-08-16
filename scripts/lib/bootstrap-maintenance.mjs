import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { installCodexWatchdogHooks } from "../install-codex-watchdog-hooks.mjs";
import { parseInstallArgs, runInstallCommand } from "../install-skill.mjs";
import {
  configureAuthorityHostStartup,
  readAuthorityHostStartup,
  readInstalledAuthorityHost,
  reconcileStableAuthorityHost,
  setAuthorityHostStartup,
  startInstalledAuthorityHost,
} from "./authority-host-install.mjs";
import { confirmApply } from "./bootstrap-install.mjs";
import {
  checkBootstrapEnvironment,
  discoverInstallations,
} from "./bootstrap-cli.mjs";
import { createGitHubReleaseClient } from "./release-self-update.mjs";
import {
  compareInstalledManifest,
  compareStableVersions,
  readInstalledManifest,
} from "./stable-release-update.mjs";
import { readUserConfig, resolveAuthorityMode } from "./user-config.mjs";
import { readActivationReceipt } from "./watchdog-activation.mjs";

function fail(code) {
  throw new Error(code);
}

function defaultCodexHome() {
  return resolve(process.env.CODEX_HOME || join(homedir(), ".codex"));
}

function requireValidInstallation(target, discover) {
  const found = discover({ explicitTarget: target });
  const valid = found.find((entry) => entry.valid === true && resolve(entry.target) === resolve(target));
  if (!valid) fail("bootstrap_setup_installation_missing");
  return valid;
}

function readyReceipt(receipt) {
  if (!receipt) return false;
  if (receipt.mode === "stream") return true;
  return receipt.mode === "hooks" && receipt.hookTrustVerified === true;
}

function modeRequiresAuthority(mode) {
  return mode === "high-assurance" || mode === "all";
}

function trustGuidance(changed) {
  return changed
    ? "The installed GitHub Delivery hook definition changed. Open /hooks in Codex, review the exact new definition, and trust it before running setup again."
    : "Open /hooks in Codex, review the GitHub Delivery hook definitions, trust them, then run setup again and confirm that review.";
}

function authorityProviderGuidance() {
  return "The selected authority protection mode requires a trusted authority provider, but the bundled Windows authority host is unavailable on this platform. Read-only/local workflows remain usable. Protected GitHub writes stay blocked until a compatible authority provider is configured or you explicitly choose authorityMode=off.";
}

export async function runBootstrapUpdate({
  target,
  apply = false,
  onProgress = undefined,
  dependencies = {},
} = {}) {
  if (!target) fail("bootstrap_update_target_required");
  const parse = dependencies.parseInstallArgs || parseInstallArgs;
  const run = dependencies.runInstallCommand || runInstallCommand;
  const argv = ["--update", "--target", resolve(target)];
  if (apply) argv.push("--apply");
  const options = parse(argv);
  const runDependencies = typeof onProgress === "function"
    ? { ...dependencies, onProgress }
    : dependencies;
  return run(options, runDependencies);
}

async function defaultLoadInstalledInstaller(modulePath) {
  return import(pathToFileURL(modulePath).href);
}

export async function runBootstrapSetup({
  target,
  codexHome = defaultCodexHome(),
  input = process.stdin,
  output = process.stdout,
  dependencies = {},
} = {}) {
  if (!target) fail("bootstrap_setup_installation_missing");
  target = resolve(target);
  codexHome = resolve(codexHome);

  const discover = dependencies.discoverInstallations || discoverInstallations;
  requireValidInstallation(target, discover);
  const reconcileAuthority = dependencies.reconcileStableAuthorityHost || reconcileStableAuthorityHost;
  const startAuthority = dependencies.startInstalledAuthorityHost || startInstalledAuthorityHost;
  const authorityHost = await reconcileAuthority({
    scriptPath: join(target, "authority-host", "windows", "install-release.ps1"),
  });
  const authorityUnavailable =
    authorityHost?.action === "unsupported" && authorityHost?.required === true;
  const authorityStarted = authorityHost?.installed?.installed
    ? await startAuthority({ installed: authorityHost.installed })
    : { started: false, reason: authorityUnavailable ? "unsupported_platform" : "not_installed" };
  output?.write?.(authorityStarted.started
    ? "\nWindows approval GUI is running in the notification area and Authority is ready.\n"
    : `\nWindows approval GUI not started (${authorityStarted.reason}).${authorityUnavailable ? "" : " Run: npx github-delivery start"}\n`);
  if (!authorityStarted.started && authorityStarted.diagnosticsPath) {
    output?.write?.(`  Diagnostics: ${authorityStarted.diagnosticsPath}\n`);
  }
  if (authorityUnavailable) {
    output?.write?.(`  ${authorityProviderGuidance()}\n`);
  }

  const readReceipt = dependencies.readActivationReceipt || readActivationReceipt;
  const receipt = readReceipt({ codexHome });
  if (readyReceipt(receipt)) {
    return {
      action: "setup",
      status: authorityUnavailable ? "authority_provider_required" : "ready",
      target,
      watchdog: receipt.mode,
      changed: authorityHost?.changed === true,
      authorityHost,
      ...(authorityUnavailable ? { guidance: authorityProviderGuidance() } : {}),
    };
  }

  const inspectHooks = dependencies.inspectHooks || installCodexWatchdogHooks;
  const hookPlan = inspectHooks({
    hooksPath: join(codexHome, "hooks.json"),
    skillDir: target,
    apply: false,
  });
  if (hookPlan?.wouldChange) {
    return {
      action: "setup",
      status: "hook_trust_required",
      target,
      watchdog: receipt?.mode || "none",
      changed: authorityHost?.changed === true,
      authorityHost,
      authorityProviderRequired: authorityUnavailable,
      hookDefinitionChanged: true,
      guidance: authorityUnavailable
        ? `${trustGuidance(true)} ${authorityProviderGuidance()}`
        : trustGuidance(true),
    };
  }

  const confirmTrust = dependencies.confirmTrust || (async () => confirmApply(
    "Have you reviewed and trusted the exact GitHub Delivery hooks in /hooks?",
    { input, output },
  ));
  const trusted = await confirmTrust({ input, output, target, codexHome });
  if (!trusted) {
    return {
      action: "setup",
      status: "hook_trust_required",
      target,
      watchdog: receipt?.mode || "none",
      changed: authorityHost?.changed === true,
      authorityHost,
      authorityProviderRequired: authorityUnavailable,
      hookDefinitionChanged: false,
      guidance: authorityUnavailable
        ? `${trustGuidance(false)} ${authorityProviderGuidance()}`
        : trustGuidance(false),
    };
  }

  const modulePath = join(target, "scripts", "install-skill.mjs");
  const loadInstalledInstaller = dependencies.loadInstalledInstaller || defaultLoadInstalledInstaller;
  const installed = await loadInstalledInstaller(modulePath);
  if (typeof installed?.parseInstallArgs !== "function" || typeof installed?.runInstallCommand !== "function") {
    fail("bootstrap_setup_installed_installer_invalid");
  }

  const options = installed.parseInstallArgs([
    "--source", target,
    "--target", target,
    "--host", "codex",
    "--codex-home", codexHome,
    "--hook-trust-verified",
    "--apply",
  ]);
  const result = await installed.runInstallCommand(options);
  const watchdog = result?.watchdog?.mode || "none";
  const watchdogReady = watchdog === "hooks" || watchdog === "stream";
  return {
    action: "setup",
    status: !watchdogReady
      ? "hook_trust_required"
      : authorityUnavailable
        ? "authority_provider_required"
        : "ready",
    target,
    watchdog,
    changed: result?.watchdog?.receiptChanged === true || authorityHost?.changed === true,
    authorityHost,
    authorityProviderRequired: authorityUnavailable,
    guidance: !watchdogReady
      ? trustGuidance(false)
      : authorityUnavailable
        ? authorityProviderGuidance()
        : null,
    result,
  };
}

export async function runBootstrapStart({ dependencies = {} } = {}) {
  const start = dependencies.startInstalledAuthorityHost || startInstalledAuthorityHost;
  return { action: "start", ...await start() };
}

export function runBootstrapAutostart({ mode = "on", dependencies = {} } = {}) {
  if (mode === "status") {
    const readStartup = dependencies.readAuthorityHostStartup || readAuthorityHostStartup;
    return { action: "autostart", mode, ...readStartup() };
  }

  if (mode === "on" && dependencies.configureAuthorityHostStartup && !dependencies.setAuthorityHostStartup) {
    const legacy = dependencies.configureAuthorityHostStartup();
    return { action: "autostart", mode, enabled: legacy.configured === true, ...legacy };
  }

  const setStartup = dependencies.setAuthorityHostStartup || setAuthorityHostStartup;
  return { action: "autostart", mode, ...setStartup({ enabled: mode === "on" }) };
}

function relation(installedVersion, latestVersion) {
  const comparison = compareStableVersions(installedVersion, latestVersion);
  if (comparison < 0) return "update";
  if (comparison > 0) return "already_ahead";
  return "already_current";
}

function doctorEligible(entry) {
  return entry.valid === true || entry.migratable === true;
}

export async function runBootstrapDoctor({
  target = null,
  codexHome = defaultCodexHome(),
  dependencies = {},
} = {}) {
  const checkEnvironment = dependencies.checkBootstrapEnvironment || checkBootstrapEnvironment;
  const discover = dependencies.discoverInstallations || discoverInstallations;
  const readManifest = dependencies.readInstalledManifest || readInstalledManifest;
  const compareManifest = dependencies.compareInstalledManifest || compareInstalledManifest;
  const readConfig = dependencies.readUserConfig || readUserConfig;
  const readAuthority = dependencies.readInstalledAuthorityHost || readInstalledAuthorityHost;
  const readReceipt = dependencies.readActivationReceipt || readActivationReceipt;
  const latestRelease = dependencies.latestRelease || (() => createGitHubReleaseClient().latestRelease());

  const environment = checkEnvironment();
  const found = discover(target ? { explicitTarget: target } : {});
  const eligible = found.filter(doctorEligible);
  let selected = null;
  if (target) selected = eligible.find((entry) => resolve(entry.target) === resolve(target)) || null;
  else if (eligible.length === 1) selected = eligible[0];
  const legacyManifestless = selected?.migratable === true && selected?.reason === "legacy_manifestless";

  const report = {
    action: "doctor",
    environment,
    target: selected?.target || (target ? resolve(target) : null),
    installations: found,
    installed: {
      ok: Boolean(selected),
      version: selected?.version || null,
      ...(legacyManifestless ? { legacyManifestless: true } : {}),
    },
    integrity: {
      ok: false,
      clean: null,
      modifications: [],
      error: legacyManifestless ? "legacy_manifest_missing" : null,
    },
    config: { ok: false, source: null, effectiveAuthorityMode: null, error: null },
    authorityHost: {
      ok: false,
      supported: process.platform === "win32",
      installed: false,
      legacy: false,
      version: null,
      sourceCommit: null,
      relation: null,
      requiredByMode: false,
      error: null,
    },
    activation: readReceipt({ codexHome: resolve(codexHome) }),
    latest: { version: null, relation: null, error: null },
  };

  if (selected && !legacyManifestless) {
    try {
      const manifest = readManifest(selected.target);
      const integrity = compareManifest({ manifest, target: selected.target });
      report.integrity = {
        ok: true,
        clean: integrity.clean,
        modifications: integrity.modifications || [],
        error: null,
      };
    } catch (error) {
      report.integrity.error = String(error?.message || error);
    }
  }

  try {
    const config = readConfig();
    const effectiveAuthorityMode = resolveAuthorityMode({ config: config.config, env: process.env });
    report.config = {
      ok: true,
      source: config?.source || null,
      effectiveAuthorityMode,
      error: null,
    };
    report.authorityHost.requiredByMode = modeRequiresAuthority(effectiveAuthorityMode);
  } catch (error) {
    report.config.error = String(error?.message || error);
  }

  try {
    const authority = readAuthority();
    const requiredByMode = report.authorityHost.requiredByMode;
    const authorityRelation = authority.supported
      ? (!authority.installed ? "missing" : (authority.legacy || !authority.version ? "legacy" : null))
      : null;
    report.authorityHost = {
      ok: true,
      supported: authority.supported,
      installed: authority.installed,
      legacy: authority.legacy,
      version: authority.version,
      sourceCommit: authority.sourceCommit,
      relation: authorityRelation,
      requiredByMode,
      error: !authority.supported && requiredByMode ? "authority_host_required_unsupported" : null,
    };
  } catch (error) {
    report.authorityHost.error = String(error?.message || error);
  }

  try {
    const release = await latestRelease();
    const tag = String(release?.tag_name || "");
    const match = /^v(\d+\.\d+\.\d+)$/.exec(tag);
    if (!match) fail("stable_release_tag_invalid");
    report.latest.version = match[1];
    if (selected?.version) report.latest.relation = relation(selected.version, match[1]);
    if (
      report.authorityHost.ok &&
      report.authorityHost.supported &&
      report.authorityHost.installed &&
      !report.authorityHost.legacy &&
      report.authorityHost.version
    ) {
      report.authorityHost.relation = relation(report.authorityHost.version, match[1]);
    }
  } catch (error) {
    report.latest.error = String(error?.message || error);
  }

  return report;
}
