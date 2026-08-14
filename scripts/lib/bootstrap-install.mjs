import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createInterface } from "node:readline/promises";

import { installSkill, parseInstallArgs } from "../install-skill.mjs";
import {
  configureAuthorityHostStartup,
  reconcileStableAuthorityHost,
  startInstalledAuthorityHost,
} from "./authority-host-install.mjs";
import { acquireVerifiedReleasePayload } from "./release-self-update.mjs";
import {
  compareInstalledManifest,
  readInstalledManifest,
} from "./stable-release-update.mjs";
import { readUserConfig } from "./user-config.mjs";
import { checkBootstrapEnvironment, discoverInstallations } from "./bootstrap-cli.mjs";

function fail(code) {
  throw new Error(code);
}

function makeWorkspace() {
  return mkdtempSync(join(tmpdir(), "github-delivery-bootstrap-"));
}

function removeWorkspace(workspace) {
  rmSync(workspace, { recursive: true, force: true });
}

function verifyInstalledRelease({ target, manifest }) {
  const installedManifest = readInstalledManifest(target);
  if (!isDeepStrictEqual(installedManifest, manifest)) {
    fail("stable_release_postinstall_manifest_mismatch");
  }
  const comparison = compareInstalledManifest({ manifest, target });
  if (!comparison.clean) fail("stable_release_postinstall_verification_failed");
  return comparison;
}

function installArgv({ source, target, host, codexHome, lifecycleHooksSupported, apply }) {
  const argv = ["--source", source, "--target", target];
  if (host) argv.push("--host", host);
  if (codexHome) argv.push("--codex-home", codexHome);
  if (lifecycleHooksSupported === true) argv.push("--lifecycle-hooks-supported");
  if (lifecycleHooksSupported === false) argv.push("--no-lifecycle-hooks");
  if (apply) argv.push("--apply");
  return argv;
}

function validPayload(payload) {
  return Boolean(
    payload
    && payload.verified === true
    && payload.kind === "github-delivery/verified-release-payload"
    && typeof payload.source === "string"
    && payload.source.length > 0
    && payload.manifest?.kind === "github-delivery/distribution-manifest"
    && payload.manifest?.name === "github-delivery"
    && typeof payload.release?.version === "string"
    && typeof payload.release?.tag === "string"
    && typeof payload.release?.sourceCommit === "string",
  );
}

async function askWithReadline(question, { input, output }) {
  const rl = createInterface({ input, output });
  try {
    return await rl.question(question);
  } catch {
    return "";
  } finally {
    rl.close();
  }
}

export async function confirmApply(
  question,
  { input = process.stdin, output = process.stdout, ask = null } = {},
) {
  const prompt = `${question} [y/N] `;
  const answer = ask
    ? await ask(prompt)
    : await askWithReadline(prompt, { input, output });
  return /^(?:y|yes)$/i.test(String(answer ?? "").trim());
}

// Explain the optional Windows approval GUI and ask whether to install it.
// Defaults to yes so non-interactive/CI installs keep installing the host and
// existing automation is not silently changed.
export async function confirmAuthorityHost(
  { input = process.stdin, output = process.stdout, ask = null } = {},
) {
  if (input?.isTTY !== true) return true;

  if (output && typeof output.write === "function") {
    output.write("\nWindows approval GUI (optional but recommended)\n");
    output.write("  The Authority host is a Windows app that turns Windows Hello into\n");
    output.write("  short-lived, exact-scope approvals for sensitive GitHub mutations\n");
    output.write("  (merges, PRs, reviews). It is what shows you a yes/no approval prompt\n");
    output.write("  before these writes happen. It is only active when you set a\n");
    output.write("  protection mode to Sensitive actions or Every GitHub write.\n");
    output.write("  You can install it later with: npx github-delivery setup\n\n");
  }
  const prompt = "Install the Windows approval GUI now? [Y/n] ";
  while (true) {
    const answer = ask
      ? await ask(prompt)
      : await askWithReadline(prompt, { input, output });
    const normalized = String(answer ?? "").trim();
    if (normalized === "" || /^(?:y|yes)$/i.test(normalized)) return true;
    if (/^(?:n|no)$/i.test(normalized)) return false;
    if (output && typeof output.write === "function") {
      output.write("Please answer yes or no.\n");
    }
  }
}

export async function confirmAuthorityStartup(
  { input = process.stdin, output = process.stdout, ask = null } = {},
) {
  if (input?.isTTY !== true) return false;
  output?.write?.("\nWindows login auto-start (optional)\n");
  output?.write?.("  This starts the installed Authority GUI when you sign in to Windows.\n");
  output?.write?.("  You can change this later with: npx github-delivery autostart\n\n");
  const prompt = "Enable Windows login auto-start? [y/N] ";
  while (true) {
    const answer = ask
      ? await ask(prompt)
      : await askWithReadline(prompt, { input, output });
    const normalized = String(answer ?? "").trim();
    if (normalized === "" || /^(?:n|no)$/i.test(normalized)) return false;
    if (/^(?:y|yes)$/i.test(normalized)) return true;
    output?.write?.("Please answer yes or no.\n");
  }
}

function renderEnvironmentCheck(environment, output) {
  if (!output || typeof output.write !== "function") return;
  output.write("\nEnvironment check\n");
  const nodeVersion = environment?.node?.version || "unknown";
  output.write(environment?.node?.ok
    ? `  Node.js ${nodeVersion}: supported\n`
    : `  Node.js ${nodeVersion}: not supported (supported majors: 22, 24, 26)\n`);
  output.write(`  Git: ${environment?.git?.ok ? "available" : "unavailable"}\n`);
  output.write(`  GitHub CLI: ${environment?.gh?.ok ? "available" : "unavailable"}\n`);
  output.write(`  GitHub authentication: ${environment?.ghAuth?.ok ? "ready" : "not ready"}\n\n`);
}

function renderPlan(plan, output) {
  if (!output || typeof output.write !== "function") return;
  const version = plan.sourceVersion || plan.release?.version || "unknown";
  output.write(`\nPlanned installation\n`);
  output.write(`  Version: ${version}\n`);
  output.write(`  Target:  ${plan.target}\n`);
  if (plan.watchdog?.hooksConfigured) {
    output.write("  Codex watchdog hooks: configure\n");
  }
  output.write("\n");
}

function renderProtectionPostflight(watchdog, output) {
  if (!output || typeof output.write !== "function") return;
  const mode = watchdog?.mode || "none";
  output.write("\nRuntime protection\n");
  if (mode === "stream") {
    output.write("  Loop interruption: active (protected stream)\n\n");
    return;
  }
  if (mode === "hooks") {
    output.write("  Codex hooks: active\n");
    output.write("  Streaming loop interruption: not active\n\n");
    return;
  }

  output.write("  LOOP INTERRUPTION NOT ACTIVE\n");
  if (watchdog?.hookTrustRequired === true || (watchdog?.hooksConfigured === true && watchdog?.hookTrustVerified !== true)) {
    output.write("  GitHub Delivery has not verified Codex hook trust for this installation.\n");
    output.write("  If these exact hooks are already trusted in Codex, they do not need to be trusted again.\n");
    output.write("  Action required:\n");
    output.write("    1. If needed, open /hooks in Codex and review/trust the GitHub Delivery hooks.\n");
    output.write("    2. Run: npx github-delivery setup\n\n");
    return;
  }
  output.write("  Run: npx github-delivery setup\n\n");
}

export async function runGuidedInstall({
  target = join(homedir(), ".agents", "skills", "github-delivery"),
  host = undefined,
  codexHome = undefined,
  lifecycleHooksSupported = undefined,
  input = process.stdin,
  output = process.stdout,
  dependencies = {},
} = {}) {
  target = resolve(target);
  const discover = dependencies.discoverInstallations || discoverInstallations;
  const found = discover({ explicitTarget: target });
  if (found.some((entry) => entry.valid === true)) fail("bootstrap_install_existing");

  const checkEnvironment = dependencies.checkBootstrapEnvironment || checkBootstrapEnvironment;
  const environment = checkEnvironment();
  renderEnvironmentCheck(environment, output);
  if (!environment?.ok) fail("bootstrap_environment_invalid");

  const make = dependencies.makeWorkspace || makeWorkspace;
  const remove = dependencies.removeWorkspace || removeWorkspace;
  const acquire = dependencies.acquireVerifiedReleasePayload || acquireVerifiedReleasePayload;
  const install = dependencies.installSkill || installSkill;
  const readConfig = dependencies.readUserConfig || readUserConfig;
  const verify = dependencies.verifyInstalledRelease || verifyInstalledRelease;
  const confirm = dependencies.confirmApply || confirmApply;
  const confirmAuthHost = dependencies.confirmAuthorityHost || confirmAuthorityHost;
  const confirmAuthStartup = dependencies.confirmAuthorityStartup || confirmAuthorityStartup;
  const reconcileAuthority = dependencies.reconcileStableAuthorityHost || reconcileStableAuthorityHost;
  const platform = dependencies.platform || process.platform;
  const startAuthority = dependencies.startInstalledAuthorityHost || startInstalledAuthorityHost;
  const workspace = make();
  let installation = null;

  try {
    const payload = await acquire({ workspace });
    if (!validPayload(payload)) fail("stable_release_payload_invalid");

    const baseArgs = {
      source: payload.source,
      target,
      host,
      codexHome,
      lifecycleHooksSupported,
    };
    const dryOptions = parseInstallArgs(installArgv({ ...baseArgs, apply: false }));
    const plan = install({
      ...dryOptions,
      update: false,
      allowDowngrade: false,
      force: false,
      apply: false,
    });
    renderPlan(plan, output);

    const accepted = await confirm("Apply these changes?", { input, output });
    if (!accepted) {
      return {
        action: "cancelled",
        apply: false,
        installed: false,
        verified: true,
        sourceVersion: payload.release.version,
        target,
      };
    }

    const configBefore = readConfig();
    const applyOptions = parseInstallArgs(installArgv({ ...baseArgs, apply: true }));
    installation = install({
      ...applyOptions,
      update: false,
      allowDowngrade: false,
      force: false,
      apply: true,
    });

    verify({ target, manifest: payload.manifest });
    const configAfter = readConfig();
    if (!isDeepStrictEqual(configBefore?.config, configAfter?.config)) {
      fail("stable_install_user_config_changed_unexpectedly");
    }

    // Ask about the optional Windows approval GUI on Windows only. Declining
    // skips Authority host reconciliation while still finishing the skill install.
    const installAuthorityHost = platform === "win32"
      ? await confirmAuthHost({ input, output })
      : true;
    let authorityHost = null;
    if (installAuthorityHost) {
      output?.write?.("\nWindows approval GUI\n  Installing and verifying the approval host...\n");
      authorityHost = await reconcileAuthority({
        expectedRelease: payload.release,
        scriptPath: join(target, "authority-host", "windows", "install-release.ps1"),
        installWhenDisabled: true,
      });
      const authorityStarted = authorityHost?.installed?.installed
        ? await startAuthority({ installed: authorityHost.installed })
        : { started: false, reason: "not_installed" };
      const enableStartup = await confirmAuthStartup({ input, output });
      const configureStartup = dependencies.configureAuthorityHostStartup || configureAuthorityHostStartup;
      const authorityStartup = enableStartup && authorityHost?.installed?.installed
        ? configureStartup({ installed: authorityHost.installed })
        : { configured: false, reason: enableStartup ? "not_installed" : "declined" };
      output?.write?.(authorityStarted.started
        ? "  Approval GUI is running in the notification area and Authority is ready.\n"
        : `  Approval GUI not started (${authorityStarted.reason}). Run: npx github-delivery start\n`);
      if (!authorityStarted.started && authorityStarted.diagnosticsPath) {
        output?.write?.(`  Diagnostics: ${authorityStarted.diagnosticsPath}\n`);
      }
      output?.write?.(authorityStartup.configured
        ? "  Windows login auto-start: configured.\n"
        : `  Windows login auto-start not enabled (${authorityStartup.reason}). Enable later with: npx github-delivery autostart\n`);
    }
    renderProtectionPostflight(installation?.watchdog, output);

    return {
      action: "install",
      apply: true,
      installed: true,
      verified: true,
      sourceVersion: payload.release.version,
      target,
      backupPath: installation?.backupPath || null,
      watchdog: installation?.watchdog || null,
      authorityHost: installAuthorityHost ? authorityHost : { action: "skipped", changed: false },
    };
  } catch (error) {
    if (installation?.backupPath && error && typeof error === "object") {
      error.backupPath = installation.backupPath;
    }
    throw error;
  } finally {
    remove(workspace);
  }
}
