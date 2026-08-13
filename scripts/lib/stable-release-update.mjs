import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import { inspectLegacyManifestlessInstallation } from "./bootstrap-cli.mjs";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function versionOf(tag) {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(String(tag || ""));
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return right[index] - left[index];
  }
  return 0;
}

export function compareStableVersions(left, right) {
  const parse = (value) => {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value || ""));
    if (!match) throw new Error("stable_release_version_invalid");
    return match.slice(1).map(Number);
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

export function selectStableRelease(releases = []) {
  const stable = releases
    .filter((release) => release && release.draft !== true && release.prerelease !== true)
    .map((release) => ({ release, version: versionOf(release.tag_name) }))
    .filter((entry) => entry.version)
    .sort((a, b) => compareVersions(a.version, b.version));
  if (stable.length === 0) throw new Error("stable_release_not_found");
  return stable[0].release;
}

function defaultListFiles(root) {
  const files = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) files.push(relative(root, absolute).split(sep).join("/"));
    }
  }
  if (existsSync(root)) walk(root);
  return files.sort();
}

export function validateManifestPath(path) {
  if (typeof path !== "string" || path.length === 0 || path.includes("\0")) {
    throw new Error("installed_manifest_path_invalid");
  }
  if (path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    throw new Error(`installed_manifest_path_invalid:${path}`);
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`installed_manifest_path_invalid:${path}`);
  }
  return path;
}

export function compareInstalledManifest({ manifest, target, dependencies = {} } = {}) {
  if (manifest?.schemaVersion !== 1 || manifest?.kind !== "github-delivery/distribution-manifest" || !Array.isArray(manifest.files)) {
    throw new Error("installed_manifest_invalid");
  }
  target = resolve(target);
  const exists = dependencies.exists || existsSync;
  const readFile = dependencies.readFile || readFileSync;
  const digest = dependencies.sha256 || sha256;
  const listFiles = dependencies.listFiles || defaultListFiles;
  const modifications = [];
  const tracked = new Set();

  for (const entry of manifest.files) {
    const relativePath = validateManifestPath(entry?.path);
    tracked.add(relativePath);
    const path = join(target, ...relativePath.split("/"));
    if (!exists(path)) {
      modifications.push({ path: relativePath, reason: "missing" });
      continue;
    }
    if (digest(readFile(path)) !== entry.sha256) {
      modifications.push({ path: relativePath, reason: "changed" });
    }
  }

  for (const path of listFiles(target)) {
    if (path === "manifest.json" || tracked.has(path)) continue;
    modifications.push({ path, reason: "local_file" });
  }
  modifications.sort((a, b) => a.path.localeCompare(b.path) || a.reason.localeCompare(b.reason));
  return { clean: modifications.length === 0, modifications };
}

export function readInstalledManifest(target) {
  const path = join(resolve(target), "manifest.json");
  if (!existsSync(path)) throw new Error("installed_manifest_missing");
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { throw new Error("installed_manifest_invalid", { cause: error }); }
}

export function releaseAssetPlan(release) {
  const tag = String(release?.tag_name || "");
  const version = versionOf(tag);
  if (!version) throw new Error("stable_release_tag_invalid");
  const versionText = version.join(".");
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const archive = `github-delivery-v${versionText}.zip`;
  const assetsByName = new Map();

  for (const asset of assets) {
    const name = asset?.name;
    if (!name) continue;
    const matches = assetsByName.get(name) || [];
    matches.push(asset);
    assetsByName.set(name, matches);
  }

  for (const required of [archive, "manifest.json", "SHA256SUMS"]) {
    const matches = assetsByName.get(required) || [];
    if (matches.length === 0) throw new Error(`stable_release_asset_missing:${required}`);
    if (matches.length > 1) throw new Error(`stable_release_asset_duplicate:${required}`);
  }

  return {
    tag,
    version: versionText,
    archive,
    manifest: "manifest.json",
    checksums: "SHA256SUMS",
  };
}

export function planStableUpdate({ releases, target, installedManifest = undefined, dependencies = {} } = {}) {
  const release = selectStableRelease(releases);
  const assets = releaseAssetPlan(release);

  let current;
  let local = null;
  let legacyManifestless = false;
  if (installedManifest !== undefined) {
    current = installedManifest;
    local = compareInstalledManifest({ manifest: current, target, dependencies });
  } else {
    try {
      current = readInstalledManifest(target);
      local = compareInstalledManifest({ manifest: current, target, dependencies });
    } catch (error) {
      if (String(error?.message || error) !== "installed_manifest_missing") throw error;
      const legacy = inspectLegacyManifestlessInstallation({ target });
      if (!legacy) throw error;
      current = { version: legacy.version };
      legacyManifestless = true;
    }
  }

  const comparison = compareStableVersions(assets.version, current.version);
  if (legacyManifestless) {
    const action = comparison < 0 ? "already_ahead" : "migrate_legacy";
    return {
      schemaVersion: 1,
      kind: "github-delivery/stable-update-plan",
      source: "latest-stable-release",
      release: { tag: assets.tag, version: assets.version },
      currentVersion: current.version || null,
      target: resolve(target),
      localModifications: null,
      safeToReplace: false,
      action,
      assets,
      legacyManifestless: true,
      integrityKnown: false,
      migrationAllowed: action === "migrate_legacy",
    };
  }

  const action = comparison === 0
    ? "already_current"
    : comparison < 0
      ? "already_ahead"
      : !local.clean
        ? "blocked_local_modifications"
        : "update";
  return {
    schemaVersion: 1,
    kind: "github-delivery/stable-update-plan",
    source: "latest-stable-release",
    release: { tag: assets.tag, version: assets.version },
    currentVersion: current.version || null,
    target: resolve(target),
    localModifications: local.modifications,
    safeToReplace: local.clean,
    action,
    assets,
  };
}

export function parseChecksums(source) {
  const map = new Map();
  for (const line of String(source || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = /^([0-9a-f]{64})  (.+)$/.exec(line.trim());
    if (!match) throw new Error("stable_release_checksums_invalid");
    const name = match[2];
    if (map.has(name)) throw new Error(`stable_release_checksums_duplicate:${name}`);
    map.set(name, match[1]);
  }
  return map;
}

export function verifyDownloadedAsset({ name, content, checksums }) {
  const expected = parseChecksums(checksums).get(name);
  if (!expected) throw new Error(`stable_release_checksum_missing:${name}`);
  if (sha256(content) !== expected) throw new Error(`stable_release_checksum_mismatch:${name}`);
  return true;
}
