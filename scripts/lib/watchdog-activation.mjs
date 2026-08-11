import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

const MODES = new Set(["none", "hooks", "stream"]);

export function selectWatchdogMode({
  host = "unknown",
  streamLaunchControlled = false,
  lifecycleHooksSupported = false,
  hookTrustVerified = false,
} = {}) {
  if (host === "codex" && streamLaunchControlled === true) {
    return { mode: "stream", degradationReason: null };
  }
  if (host === "codex" && lifecycleHooksSupported === true && hookTrustVerified === true) {
    return { mode: "hooks", degradationReason: "streaming_interruption_unavailable" };
  }
  if (host === "codex" && lifecycleHooksSupported === true) {
    return { mode: "none", degradationReason: "hook_trust_required" };
  }
  return { mode: "none", degradationReason: "progress_watchdog_unavailable" };
}

export function activationReceiptPath({ codexHome } = {}) {
  if (!codexHome) throw new Error("codexHome is required");
  return join(resolve(codexHome), "github-delivery", "watchdog-activation.json");
}

function normalizeReceipt(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.schemaVersion !== 1 || !MODES.has(value.mode)) return null;
  if (value.degradationReason !== null && typeof value.degradationReason !== "string") return null;
  if (value.launcherPath !== null && typeof value.launcherPath !== "string") return null;
  if (value.hooksConfigured !== undefined && typeof value.hooksConfigured !== "boolean") return null;
  if (value.hookTrustVerified !== undefined && typeof value.hookTrustVerified !== "boolean") return null;
  return {
    schemaVersion: 1,
    mode: value.mode,
    degradationReason: value.degradationReason,
    launcherPath: value.launcherPath,
    hooksConfigured: value.hooksConfigured === true,
    hookTrustVerified: value.hookTrustVerified === true,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
  };
}

export function readActivationReceipt({ codexHome } = {}) {
  const path = activationReceiptPath({ codexHome });
  if (!existsSync(path)) return null;
  try {
    return normalizeReceipt(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return null;
  }
}

function semanticReceipt({
  mode,
  degradationReason = null,
  launcherPath = null,
  hooksConfigured = false,
  hookTrustVerified = false,
}) {
  if (!MODES.has(mode)) throw new Error(`invalid watchdog mode: ${mode}`);
  if (degradationReason !== null && typeof degradationReason !== "string") {
    throw new Error("degradationReason must be a string or null");
  }
  if (launcherPath !== null && typeof launcherPath !== "string") {
    throw new Error("launcherPath must be a string or null");
  }
  return {
    schemaVersion: 1,
    mode,
    degradationReason,
    launcherPath: launcherPath ? resolve(launcherPath) : null,
    hooksConfigured: hooksConfigured === true,
    hookTrustVerified: hookTrustVerified === true,
  };
}

function sameSemantics(left, right) {
  return Boolean(
    left &&
      right &&
      left.schemaVersion === right.schemaVersion &&
      left.mode === right.mode &&
      left.degradationReason === right.degradationReason &&
      left.launcherPath === right.launcherPath &&
      left.hooksConfigured === right.hooksConfigured &&
      left.hookTrustVerified === right.hookTrustVerified,
  );
}

export function writeActivationReceipt({
  codexHome,
  mode,
  degradationReason = null,
  launcherPath = null,
  hooksConfigured = false,
  hookTrustVerified = false,
  apply = false,
  now = () => new Date(),
} = {}) {
  const path = activationReceiptPath({ codexHome });
  const desired = semanticReceipt({
    mode,
    degradationReason,
    launcherPath,
    hooksConfigured,
    hookTrustVerified,
  });
  const existing = readActivationReceipt({ codexHome });
  const changed = !sameSemantics(existing, desired);
  const receipt = changed
    ? { ...desired, updatedAt: now().toISOString() }
    : existing;

  if (apply && changed) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  return {
    path,
    changed,
    applied: apply && changed,
    receipt,
  };
}
