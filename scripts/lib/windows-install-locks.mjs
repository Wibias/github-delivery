import { join, resolve } from "node:path";

import { boundedSpawnSync } from "./subprocess-policy.mjs";

function normalizeBlocker(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const pid = Number(value.pid);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const rawName = String(value.name || `PID ${pid}`).trim();
  const name = rawName && rawName.includes(".") ? rawName : `${rawName || `PID ${pid}`}.exe`;
  const paths = Array.isArray(value.paths)
    ? [...new Set(value.paths.map((path) => String(path || "").trim()).filter(Boolean))]
    : [];
  return { pid, name, paths };
}

function parseJsonOutput(stdout) {
  const raw = String(stdout || "").trim();
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("windows_install_lock_probe_invalid_json");
  }
  const values = Array.isArray(parsed) ? parsed : [parsed];
  return values.map(normalizeBlocker).filter(Boolean).sort((left, right) => left.pid - right.pid);
}

function scriptPath() {
  return resolve(join(import.meta.dirname, "..", "windows-install-locks.ps1"));
}

export function inspectWindowsInstallLocks(target, {
  platform = process.platform,
  spawn = boundedSpawnSync,
} = {}) {
  if (platform !== "win32") return [];
  const resolvedTarget = resolve(target);
  const result = spawn("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath(),
    "-Mode",
    "Inspect",
    "-Target",
    resolvedTarget,
  ], {
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    timeout: 20_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result?.error || result?.status !== 0) {
    const detail = String(result?.stderr || result?.error?.message || "").trim();
    const error = new Error("windows_install_lock_probe_failed");
    if (detail) error.detail = detail;
    throw error;
  }
  return parseJsonOutput(result.stdout);
}

export function requestGracefulProcessClose(processInfo, {
  platform = process.platform,
  spawn = boundedSpawnSync,
} = {}) {
  if (platform !== "win32") return { requested: false, reason: "unsupported_platform" };
  const pid = Number(processInfo?.pid);
  if (!Number.isInteger(pid) || pid <= 0) return { requested: false, reason: "invalid_pid" };
  if (pid === process.pid) return { requested: false, pid, reason: "current_process" };
  const result = spawn("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath(),
    "-Mode",
    "Close",
    "-ProcessId",
    String(pid),
  ], {
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  });
  if (result?.error || result?.status !== 0) {
    return {
      requested: false,
      pid,
      reason: "close_request_failed",
      detail: String(result?.stderr || result?.error?.message || "").trim() || null,
    };
  }
  const raw = String(result.stdout || "").trim();
  if (!raw) return { requested: true, pid };
  try {
    const parsed = JSON.parse(raw);
    return {
      requested: parsed?.requested === true,
      pid,
      reason: parsed?.reason || null,
    };
  } catch {
    return { requested: true, pid };
  }
}
