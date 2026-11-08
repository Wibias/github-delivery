import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { posix as posixPath, win32 as win32Path } from "node:path";

export const AUTHORITY_MODES = Object.freeze([
  "off",
  "high-assurance",
  "all",
]);

export const CI_EVIDENCE_MODES = Object.freeze(["remote", "local"]);

export const DEFAULT_USER_CONFIG = Object.freeze({
  schemaVersion: 2,
  authorityMode: "high-assurance",
  ciEvidence: Object.freeze({
    defaultMode: "remote",
    repositories: Object.freeze({}),
  }),
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

export function normalizeRepositoryKey(value) {
  const match = String(value || "")
    .trim()
    .match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!match) {
    throw codedError("github_delivery_config_ci_evidence_repository_invalid");
  }
  return `${match[1].toLowerCase()}/${match[2].toLowerCase()}`;
}

function normalizeCiEvidence(value) {
  if (value === null || value === undefined) {
    return { defaultMode: "remote", repositories: {} };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw codedError("github_delivery_config_ci_evidence_invalid");
  }
  const defaultMode = value.defaultMode ?? "remote";
  if (defaultMode !== "remote") {
    throw codedError("github_delivery_config_ci_evidence_default_mode_invalid");
  }
  const source = value.repositories ?? {};
  if (typeof source !== "object" || Array.isArray(source)) {
    throw codedError("github_delivery_config_ci_evidence_repositories_invalid");
  }
  const repositories = {};
  for (const [rawKey, entry] of Object.entries(source)) {
    const key = normalizeRepositoryKey(rawKey);
    if (
      entry === null ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      entry.mode !== "local"
    ) {
      throw codedError("github_delivery_config_ci_evidence_repository_mode_invalid");
    }
    const waiver = String(entry.waiver || "").trim();
    if (!waiver || waiver.length > 200) {
      throw codedError("github_delivery_config_ci_evidence_waiver_required");
    }
    const normalized = { mode: "local", waiver };
    if (entry.recordedAt !== undefined) {
      const parsed = Date.parse(String(entry.recordedAt));
      if (!Number.isFinite(parsed)) {
        throw codedError("github_delivery_config_ci_evidence_recorded_at_invalid");
      }
      normalized.recordedAt = new Date(parsed).toISOString();
    }
    repositories[key] = normalized;
  }
  return { defaultMode, repositories };
}

export function normalizeUserConfig(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw codedError("github_delivery_config_invalid");
  }
  if (value.schemaVersion !== 1 && value.schemaVersion !== 2) {
    throw codedError("github_delivery_config_schema_version_unsupported");
  }
  return {
    schemaVersion: 2,
    authorityMode: authorityMode(
      value.authorityMode,
      "github_delivery_config_authority_mode_invalid",
    ),
    ciEvidence:
      value.schemaVersion === 1
        ? { defaultMode: "remote", repositories: {} }
        : normalizeCiEvidence(value.ciEvidence),
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
    return posixPath.join(
      home,
      "Library",
      "Application Support",
      "github-delivery",
      "config.json",
    );
  }
  const configRoot = env.XDG_CONFIG_HOME || posixPath.join(home, ".config");
  return posixPath.join(configRoot, "github-delivery", "config.json");
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
  const pathApi = platform === "win32" ? win32Path : posixPath;
  const parent = pathApi.dirname(filePath);
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

export function resolveCiEvidenceMode({
  config = DEFAULT_USER_CONFIG,
  repo,
} = {}) {
  const normalized = normalizeUserConfig(config);
  const key = normalizeRepositoryKey(repo);
  const entry = normalized.ciEvidence.repositories[key] || null;
  if (entry?.mode === "local") {
    return {
      mode: "local",
      waiver: entry.waiver,
      recordedAt: entry.recordedAt ?? null,
    };
  }
  return { mode: "remote", waiver: null, recordedAt: null };
}

export function withCiEvidenceRepository(
  config,
  { repository, mode, waiver = null, recordedAt = new Date().toISOString() } = {},
) {
  const normalized = normalizeUserConfig(config);
  if (!CI_EVIDENCE_MODES.includes(mode)) {
    throw codedError("github_delivery_config_ci_evidence_mode_invalid");
  }
  const key = normalizeRepositoryKey(repository);
  const repositories = { ...normalized.ciEvidence.repositories };
  if (mode === "local") {
    const text = String(waiver || "").trim();
    if (!text) {
      throw codedError("github_delivery_config_ci_evidence_waiver_required");
    }
    repositories[key] = { mode: "local", waiver: text, recordedAt };
  } else {
    delete repositories[key];
  }
  return normalizeUserConfig({
    ...normalized,
    ciEvidence: { ...normalized.ciEvidence, repositories },
  });
}
