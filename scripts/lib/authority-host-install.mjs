import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve, win32 as win32Path } from "node:path";
import { fileURLToPath } from "node:url";

import { acquireVerifiedAuthorityHostPayload } from "./authority-host-release.mjs";
import { createGitHubReleaseClient } from "./release-self-update.mjs";
import { compareStableVersions } from "./stable-release-update.mjs";
import { readUserConfig, resolveAuthorityMode } from "./user-config.mjs";

function fail(code, detail = "") {
  throw new Error(detail ? `${code}:${detail}` : code);
}

export function authorityHostInstallRoot({
  platform = process.platform,
  env = process.env,
  home = homedir(),
} = {}) {
  if (platform !== "win32") return null;
  const local = env.LOCALAPPDATA || win32Path.join(home, "AppData", "Local");
  return win32Path.join(local, "GitHubDeliveryAuthority");
}

function normalizeInstallRecord(value) {
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    value.schemaVersion !== 1 || value.kind !== "github-delivery/authority-host-install" ||
    !/^\d+\.\d+\.\d+$/.test(String(value.version || "")) ||
    !/^[0-9a-f]{40}$/i.test(String(value.sourceCommit || "")) ||
    typeof value.appDir !== "string" || !/^app\/v\d+\.\d+\.\d+$/.test(value.appDir)
  ) fail("authority_host_install_record_invalid");
  return {
    schemaVersion: 1,
    kind: value.kind,
    version: value.version,
    sourceCommit: value.sourceCommit.toLowerCase(),
    appDir: value.appDir,
    installedAt: typeof value.installedAt === "string" ? value.installedAt : null,
  };
}

export function readInstalledAuthorityHost({
  platform = process.platform,
  env = process.env,
  home = homedir(),
  exists = existsSync,
  readFile = readFileSync,
} = {}) {
  const root = authorityHostInstallRoot({ platform, env, home });
  if (!root) return { supported: false, installed: false, legacy: false, root: null, version: null, sourceCommit: null };
  const recordPath = win32Path.join(root, "authority-host-install.json");
  if (exists(recordPath)) {
    let record;
    try { record = normalizeInstallRecord(JSON.parse(readFile(recordPath, "utf8"))); }
    catch (error) {
      if (String(error?.message || "").startsWith("authority_host_install_record_invalid")) throw error;
      fail("authority_host_install_record_invalid");
    }
    const exePath = win32Path.join(root, ...record.appDir.split("/"), "GitHubDeliveryAuthority.exe");
    return {
      supported: true,
      installed: exists(exePath),
      legacy: false,
      root,
      recordPath,
      exePath,
      version: record.version,
      sourceCommit: record.sourceCommit,
      record,
    };
  }

  const legacyExe = win32Path.join(root, "GitHubDeliveryAuthority.exe");
  if (exists(legacyExe)) {
    return {
      supported: true,
      installed: true,
      legacy: true,
      root,
      recordPath,
      exePath: legacyExe,
      version: null,
      sourceCommit: null,
      record: null,
    };
  }
  return { supported: true, installed: false, legacy: false, root, recordPath, exePath: null, version: null, sourceCommit: null, record: null };
}

export function planAuthorityHostUpdate({ mode, targetVersion, installed } = {}) {
  if (!installed?.supported) return { action: "unsupported", required: false, currentVersion: null, targetVersion };
  if (!/^\d+\.\d+\.\d+$/.test(String(targetVersion || ""))) fail("authority_host_target_version_invalid");
  if (!installed.installed && mode === "off") {
    return { action: "disabled", required: false, currentVersion: null, targetVersion };
  }
  if (!installed.installed) return { action: "install", required: true, currentVersion: null, targetVersion };
  if (installed.legacy || !installed.version) return { action: "upgrade_legacy", required: true, currentVersion: null, targetVersion };
  const comparison = compareStableVersions(installed.version, targetVersion);
  if (comparison > 0) return { action: "already_ahead", required: false, currentVersion: installed.version, targetVersion };
  if (comparison === 0) return { action: "already_current", required: false, currentVersion: installed.version, targetVersion };
  return { action: "update", required: true, currentVersion: installed.version, targetVersion };
}

function defaultInstallScript() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../authority-host/windows/install-release.ps1");
}

export function installVerifiedAuthorityHost({
  payload,
  scriptPath = defaultInstallScript(),
  runner = spawnSync,
} = {}) {
  if (!payload?.verified || payload?.kind !== "github-delivery/verified-authority-host-payload") fail("authority_host_verified_payload_required");
  const result = runner(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy", "Bypass",
      "-File", scriptPath,
      "-SourceDir", payload.source,
      "-ExpectedVersion", payload.metadata.version,
      "-ExpectedSourceCommit", payload.metadata.sourceCommit,
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      stdio: "pipe",
      shell: false,
    },
  );
  if (!result || result.error || result.status !== 0) {
    fail("authority_host_install_failed", result?.stderr || result?.error?.message || "install-release.ps1 failed");
  }
  return { installed: true, version: payload.metadata.version, sourceCommit: payload.metadata.sourceCommit, stdout: result.stdout || "" };
}

function makeWorkspace() {
  return mkdtempSync(join(tmpdir(), "github-delivery-authority-update-"));
}

export async function reconcileStableAuthorityHost({
  expectedRelease,
  platform = process.platform,
  env = process.env,
  home = homedir(),
  client = createGitHubReleaseClient(),
  attestationRunner = undefined,
  installRunner = spawnSync,
  dependencies = {},
} = {}) {
  if (!expectedRelease || !/^v\d+\.\d+\.\d+$/.test(String(expectedRelease.tag || "")) ||
      !/^\d+\.\d+\.\d+$/.test(String(expectedRelease.version || "")) ||
      !/^[0-9a-f]{40}$/i.test(String(expectedRelease.sourceCommit || ""))) {
    fail("authority_host_expected_release_invalid");
  }

  const readInstalled = dependencies.readInstalledAuthorityHost || readInstalledAuthorityHost;
  const readConfig = dependencies.readUserConfig || readUserConfig;
  const install = dependencies.installVerifiedAuthorityHost || installVerifiedAuthorityHost;
  const installed = readInstalled({ platform, env, home });
  if (!installed.supported) return { action: "unsupported", changed: false, installed };
  const config = readConfig({ platform, env, home });
  const mode = resolveAuthorityMode({ config: config.config, env });
  const plan = planAuthorityHostUpdate({ mode, targetVersion: expectedRelease.version, installed });
  if (!plan.required) return { ...plan, changed: false, installed, mode };

  const release = await client.latestRelease();
  if (release?.tag_name !== expectedRelease.tag) fail("authority_host_release_changed_during_update");
  const workspace = (dependencies.makeWorkspace || makeWorkspace)();
  try {
    const acquire = dependencies.acquireVerifiedAuthorityHostPayload || acquireVerifiedAuthorityHostPayload;
    const payload = await acquire({
      release,
      workspace,
      client,
      expectedVersion: expectedRelease.version,
      expectedSourceCommit: expectedRelease.sourceCommit,
      attestationRunner,
    });
    const result = install({ payload, runner: installRunner });
    const after = readInstalled({ platform, env, home });
    if (!after.installed || after.version !== expectedRelease.version || after.sourceCommit !== expectedRelease.sourceCommit.toLowerCase()) {
      fail("authority_host_postinstall_verification_failed");
    }
    return { ...plan, changed: true, installed: after, mode, result };
  } finally {
    (dependencies.removeWorkspace || ((path) => rmSync(path, { recursive: true, force: true })))(workspace);
  }
}
