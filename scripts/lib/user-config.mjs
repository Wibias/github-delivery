import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path, { dirname, join, win32 as win32Path } from "node:path";

export const AUTHORITY_MODES = Object.freeze([
  "off",
  "high-assurance",
  "all",
]);

export const DEFAULT_USER_CONFIG = Object.freeze({
  schemaVersion: 1,
  authorityMode: "off",
});

function codedError(code, cause = undefined) {
  const error = cause === undefined ? new Error(code) : new Error(code, { cause });
  error.code = code;
  return error;
}

function authorityMode(value, code) {
  if (!AUTHORITY_MODES.includes(value)) throw codedError(code);
  return value;
}

export function normalizeUserConfig(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw codedError("github_delivery_config_invalid");
  }
  if (value.schemaVersion !== 1) {
    throw codedError("github_delivery_config_schema_version_unsupported");
  }
  return {
    schemaVersion: 1,
    authorityMode: authorityMode(
      value.authorityMode,
      "github_delivery_config_authority_mode_invalid",
    ),
  };
}

export function userConfigPath({
  platform = process.platform,
  env = process.env,
  home = homedir(),
} = {}) {
  if (platform === "win32") {
    const local = env.LOCALAPPDATA || win32Path.join(home, "AppData", "Local");
    return win32Path.join(local, "github-delivery", "config.json");
  }
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "github-delivery", "config.json");
  }
  const configRoot = env.XDG_CONFIG_HOME || join(home, ".config");
  return join(configRoot, "github-delivery", "config.json");
}

export function readUserConfig({
  path: configuredPath = undefined,
  platform = process.platform,
  env = process.env,
  home = homedir(),
  exists = existsSync,
  readFile = readFileSync,
} = {}) {
  const filePath = configuredPath || userConfigPath({ platform, env, home });
  if (!exists(filePath)) {
    return {
      path: filePath,
      source: "default",
      config: { ...DEFAULT_USER_CONFIG },
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "github_delivery_config_invalid_json") throw error;
    throw codedError("github_delivery_config_invalid_json", error);
  }

  return {
    path: filePath,
    source: "file",
    config: normalizeUserConfig(parsed),
  };
}

export function writeUserConfig(
  value,
  {
    path: configuredPath = undefined,
    platform = process.platform,
    env = process.env,
    home = homedir(),
    mkdir = mkdirSync,
    writeFile = writeFileSync,
    rename = renameSync,
    chmod = chmodSync,
    randomSuffix = `${process.pid}-${Date.now()}`,
  } = {},
) {
  const config = normalizeUserConfig(value);
  const filePath = configuredPath || userConfigPath({ platform, env, home });
  const parent =
    platform === "win32" ? win32Path.dirname(filePath) : dirname(filePath);
  const tempPath = `${filePath}.${randomSuffix}.tmp`;

  mkdir(parent, { recursive: true });
  writeFile(tempPath, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  rename(tempPath, filePath);
  if (platform !== "win32") {
    try {
      chmod(filePath, 0o600);
    } catch {
      // The config is still valid if a filesystem does not support POSIX modes.
    }
  }
  return { path: filePath, config };
}

export function resolveAuthorityMode({
  config = DEFAULT_USER_CONFIG,
  env = process.env,
} = {}) {
  if (env.GITHUB_DELIVERY_REQUIRE_TRUSTED_AUTHORITY === "1") return "all";
  if (env.GITHUB_DELIVERY_AUTHORITY_MODE !== undefined) {
    return authorityMode(
      String(env.GITHUB_DELIVERY_AUTHORITY_MODE).trim().toLowerCase(),
      "github_delivery_authority_mode_invalid",
    );
  }
  return normalizeUserConfig(config).authorityMode;
}
