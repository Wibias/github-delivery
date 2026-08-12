import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { installCodexWatchdogHooks } from "../install-codex-watchdog-hooks.mjs";
import { parseInstallArgs, runInstallCommand } from "../install-skill.mjs";
import {
  readInstalledAuthorityHost,
  reconcileStableAuthorityHost,
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

export async function runBootstrapUpdate({
  target,
  apply = false,
  dependencies = {},
} = {}) {
  if (!target) fail("bootstrap_update_target_required");
  const parse = dependencies.parseInstallArgs || parseInstallArgs;
  const run = dependencies.runInstallCommand || runInstallCommand;
  const argv = ["--update", "--target", resolve(target)];
  if (apply) argv.push("--apply");
  const options = parse(argv);
  return run(options);
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
  const authorityHost = await reconcileAuthority({
    scriptPath: join(target, "authority-host", "windows", "install-release.ps1"),
  });
  if (authorityHost?.action === "unsupported" && authorityHost?.required === true) {
    fail("bootstrap_setup_authority_host_unsupported");
  }

  const readReceipt = dependencies.readActivationReceipt || readActivationReceipt;
  const receipt = readReceipt({ codexHome });
  if (readyReceipt(receipt)) {
    return {
      action: "setup",
      status: "ready",
      target,
      watchdog: receipt.mode,
      changed: authorityHost?.changed === true,
      authorityHost,
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
      hookDefinitionChanged: true,
      guidance: trustGuidance(true),
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
      hookDefinitionChanged: false,
      guidance: trustGuidance(false),
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
  return {
    action: "setup",
    status: watchdog === "hooks" || watchdog === "stream" ? "ready" : "hook_trust_required",
    target,
    watchdog,
    changed: result?.watchdog?.receiptChanged === true || authorityHost?.changed === true,
    authorityHost,
    guidance: watchdog === "hooks" || watchdog === "stream" ? null : trustGuidance(false),
    result,
  };
}

function relation(installedVersion, latestVersion) {
  const comparison = compareStableVersions(installedVersion, latestVersion);
  if (comparison < 0) return "update";
  if (comparison > 0) return "already_ahead";
  return "already_current";
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
  const valid = found.filter((entry) => entry.valid === true);
  let selected = null;
  if (target) selected = valid.find((entry) => resolve(entry.target) === resolve(target)) || null;
  else if (valid.length === 1) selected = valid[0];

  const report = {
    action: "doctor",
    environment,
    target: selected?.target || (target ? resolve(target) : null),
    installations: found,
    installed: { ok: Boolean(selected), version: selected?.version || null },
    integrity: { ok: false, clean: null, modifications: [], error: null },
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

  let manifest = null;
  if (selected) {
    try {
      manifest = readManifest(selected.target);
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
    if (manifest?.version) report.latest.relation = relation(manifest.version, match[1]);
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
