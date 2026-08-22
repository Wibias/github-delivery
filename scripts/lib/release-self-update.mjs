import { boundedSpawnSync } from "./subprocess-policy.mjs";
import { createHash, timingSafeEqual } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { extractVerifiedReleaseZip } from "./release-zip.mjs";
import { assertPortablePathIdentity } from "./release-path-identity.mjs";
import {
  planStableUpdate,
  releaseAssetPlan,
  verifyDownloadedAsset,
} from "./stable-release-update.mjs";

const DEFAULT_REPOSITORY = "Wibias/github-delivery";
const RELEASE_WORKFLOW = "Wibias/github-delivery/.github/workflows/release.yml";
const API_ROOT = "https://api.github.com";
const API_VERSION = "2022-11-28";
const MAX_REDIRECTS = 5;
const MAX_TAG_PEELS = 8;
const DOWNLOAD_LIMITS = Object.freeze({
  archive: 32 * 1024 * 1024,
  manifest: 4 * 1024 * 1024,
  checksums: 1024 * 1024,
});

function fail(code, detail = "") {
  throw new Error(detail ? `${code}: ${detail}` : code);
}

function githubHeaders() {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": "github-delivery-release-self-update",
  };
}

function isSemverTag(value) {
  return typeof value === "string" && /^v\d+\.\d+\.\d+$/.test(value);
}

function isCommitSha(value) {
  return typeof value === "string" && /^[0-9a-f]{40}$/i.test(value);
}

function parseHttpsUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("stable_release_download_url_invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    fail("stable_release_download_url_invalid");
  }
  return url;
}

function isRedirectStatus(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function readLimitedBody(response, limit) {
  if (!Number.isSafeInteger(limit) || limit < 0) {
    fail("stable_release_download_limit_invalid");
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declared = Number(contentLength);
    if (!Number.isSafeInteger(declared) || declared < 0) {
      fail("stable_release_download_length_invalid");
    }
    if (declared > limit) {
      fail("stable_release_download_limit_exceeded");
    }
  }

  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > limit) {
        try { await reader.cancel(); } catch {}
        fail("stable_release_download_limit_exceeded");
      }
      chunks.push(chunk);
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  return Buffer.concat(chunks, total);
}

function validateManifestPath(value) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.includes("\0")
    || value.includes("\\")
    || value.startsWith("/")
    || /^[A-Za-z]:/.test(value)
    || value.includes("//")
  ) {
    fail("stable_release_manifest_path_invalid");
  }

  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    fail("stable_release_manifest_path_invalid");
  }
  if (value === "manifest.json") {
    fail("stable_release_manifest_path_invalid");
  }
  return value;
}

async function fetchJson(fetchImpl, url, errorCode) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      headers: githubHeaders(),
    });
  } catch (error) {
    fail(errorCode, error?.message || "request failed");
  }
  if (!response || response.status < 200 || response.status >= 300) {
    fail(errorCode, `HTTP ${response?.status ?? "unknown"}`);
  }
  try {
    return await response.json();
  } catch {
    fail(errorCode, "invalid JSON response");
  }
}

function uniqueAsset(release, name) {
  const matches = release.assets.filter((asset) => asset?.name === name);
  if (matches.length === 0) fail("stable_release_asset_missing", name);
  if (matches.length > 1) fail("stable_release_asset_duplicate", name);
  return matches[0];
}

function parseManifestBytes(bytes, version) {
  let raw;
  try {
    raw = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("stable_release_manifest_invalid");
  }
  return validateReleaseManifest(raw, { version });
}

export function createGitHubReleaseClient({
  fetchImpl = globalThis.fetch,
  repository = DEFAULT_REPOSITORY,
} = {}) {
  if (typeof fetchImpl !== "function") fail("stable_release_network_client_unavailable");
  if (repository !== DEFAULT_REPOSITORY) fail("stable_release_repository_invalid");

  async function latestRelease() {
    const release = await fetchJson(
      fetchImpl,
      `${API_ROOT}/repos/${repository}/releases/latest`,
      "stable_release_metadata_invalid",
    );
    if (
      !release
      || typeof release !== "object"
      || release.draft !== false
      || release.prerelease !== false
      || !isSemverTag(release.tag_name)
      || !Array.isArray(release.assets)
    ) {
      fail("stable_release_metadata_invalid");
    }
    return release;
  }

  async function downloadAsset(asset, limit) {
    if (!asset || typeof asset !== "object" || typeof asset.browser_download_url !== "string") {
      fail("stable_release_download_url_invalid");
    }

    let current = parseHttpsUrl(asset.browser_download_url);
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      let response;
      try {
        response = await fetchImpl(current, {
          method: "GET",
          redirect: "manual",
          headers: {
            Accept: "application/octet-stream",
            "User-Agent": "github-delivery-release-self-update",
          },
        });
      } catch (error) {
        fail("stable_release_download_failed", error?.message || "request failed");
      }

      if (isRedirectStatus(response.status)) {
        if (redirects === MAX_REDIRECTS) fail("stable_release_download_redirect_limit_exceeded");
        const location = response.headers.get("location");
        if (!location) fail("stable_release_download_url_invalid");
        let next;
        try {
          next = new URL(location, current);
        } catch {
          fail("stable_release_download_url_invalid");
        }
        current = parseHttpsUrl(next.href);
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        fail("stable_release_download_failed", `HTTP ${response.status}`);
      }
      return readLimitedBody(response, limit);
    }
    fail("stable_release_download_redirect_limit_exceeded");
  }

  async function resolveTagCommit(tag) {
    if (!isSemverTag(tag)) fail("stable_release_tag_resolution_invalid");

    let object;
    try {
      const ref = await fetchJson(
        fetchImpl,
        `${API_ROOT}/repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`,
        "stable_release_tag_resolution_invalid",
      );
      object = ref?.object;
    } catch (error) {
      if (String(error?.message || "").includes("stable_release_tag_resolution_invalid")) throw error;
      fail("stable_release_tag_resolution_invalid");
    }

    const seen = new Set();
    for (let depth = 0; depth <= MAX_TAG_PEELS; depth += 1) {
      if (!object || typeof object !== "object" || typeof object.type !== "string" || !isCommitSha(object.sha)) {
        fail("stable_release_tag_resolution_invalid");
      }
      const sha = object.sha.toLowerCase();
      if (object.type === "commit") return sha;
      if (object.type !== "tag" || depth === MAX_TAG_PEELS || seen.has(sha)) {
        fail("stable_release_tag_resolution_invalid");
      }
      seen.add(sha);
      const tagObject = await fetchJson(
        fetchImpl,
        `${API_ROOT}/repos/${repository}/git/tags/${sha}`,
        "stable_release_tag_resolution_invalid",
      );
      object = tagObject?.object;
    }
    fail("stable_release_tag_resolution_invalid");
  }

  return { latestRelease, downloadAsset, resolveTagCommit };
}

export function verifyGitHubAssetDigest(asset, content) {
  const digest = asset?.digest;
  if (digest === undefined || digest === null || digest === "") return true;
  if (typeof digest !== "string" || !/^sha256:[0-9a-f]{64}$/i.test(digest)) {
    fail("stable_release_asset_digest_invalid");
  }

  const expected = Buffer.from(digest.slice("sha256:".length), "hex");
  const actual = createHash("sha256").update(content).digest();
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    fail("stable_release_asset_digest_mismatch");
  }
  return true;
}

export function validateReleaseManifest(value, { version } = {}) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.schemaVersion !== 1
    || value.kind !== "github-delivery/distribution-manifest"
    || value.name !== "github-delivery"
    || typeof version !== "string"
    || value.version !== version
    || !/^\d+\.\d+\.\d+$/.test(value.version)
    || !isCommitSha(value.sourceCommit)
    || !Array.isArray(value.files)
  ) {
    fail("stable_release_manifest_invalid");
  }

  const seen = new Set();
  const files = value.files.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      fail("stable_release_manifest_invalid");
    }
    const path = validateManifestPath(entry.path);
    if (seen.has(path)) fail("stable_release_manifest_path_duplicate");
    seen.add(path);
    if (
      !Number.isSafeInteger(entry.bytes)
      || entry.bytes < 0
      || (entry.mode !== "0644" && entry.mode !== "0755")
      || typeof entry.sha256 !== "string"
      || !/^[0-9a-f]{64}$/i.test(entry.sha256)
    ) {
      fail("stable_release_manifest_invalid");
    }
    return {
      path,
      bytes: entry.bytes,
      mode: entry.mode,
      sha256: entry.sha256.toLowerCase(),
    };
  });
  assertPortablePathIdentity(files.map((entry) => entry.path), { code: "stable_release_manifest_path" });

  return {
    schemaVersion: 1,
    kind: "github-delivery/distribution-manifest",
    name: "github-delivery",
    version: value.version,
    sourceCommit: value.sourceCommit.toLowerCase(),
    files,
  };
}

export function verifyReleaseAttestation({
  archivePath,
  tag,
  sourceCommit,
  runner = (program, args, options) => boundedSpawnSync(program, args, options),
} = {}) {
  if (typeof archivePath !== "string" || archivePath.length === 0 || !isSemverTag(tag) || !isCommitSha(sourceCommit)) {
    fail("stable_release_attestation_failed");
  }

  let result;
  try {
    result = runner(
      "gh",
      [
        "attestation", "verify", archivePath,
        "--repo", DEFAULT_REPOSITORY,
        "--signer-workflow", RELEASE_WORKFLOW,
        "--source-ref", `refs/tags/${tag}`,
        "--source-digest", sourceCommit.toLowerCase(),
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        stdio: "pipe",
        shell: false,
      },
    );
  } catch (error) {
    fail("stable_release_attestation_failed", error?.message || "gh attestation verify failed");
  }

  if (!result || result.error || result.status !== 0) {
    fail("stable_release_attestation_failed", result?.stderr || result?.error?.message || "gh attestation verify failed");
  }
  return true;
}

export async function acquireVerifiedReleasePayload({
  workspace,
  client = createGitHubReleaseClient(),
  attestationRunner = undefined,
  dependencies = {},
} = {}) {
  if (typeof workspace !== "string" || workspace.length === 0) fail("stable_release_workspace_invalid");
  if (!client || typeof client.latestRelease !== "function" || typeof client.downloadAsset !== "function" || typeof client.resolveTagCommit !== "function") {
    fail("stable_release_client_invalid");
  }

  const extract = dependencies.extractVerifiedReleaseZip || extractVerifiedReleaseZip;
  const release = await client.latestRelease();
  const assets = releaseAssetPlan(release);
  const archiveAsset = uniqueAsset(release, assets.archive);
  const manifestAsset = uniqueAsset(release, assets.manifest);
  const checksumsAsset = uniqueAsset(release, assets.checksums);

  const [archive, manifestBytes, checksums] = await Promise.all([
    client.downloadAsset(archiveAsset, DOWNLOAD_LIMITS.archive),
    client.downloadAsset(manifestAsset, DOWNLOAD_LIMITS.manifest),
    client.downloadAsset(checksumsAsset, DOWNLOAD_LIMITS.checksums),
  ]);
  if (!Buffer.isBuffer(archive) || !Buffer.isBuffer(manifestBytes) || !Buffer.isBuffer(checksums)) {
    fail("stable_release_download_invalid");
  }

  verifyGitHubAssetDigest(archiveAsset, archive);
  verifyGitHubAssetDigest(manifestAsset, manifestBytes);
  verifyGitHubAssetDigest(checksumsAsset, checksums);
  verifyDownloadedAsset({ name: assets.archive, content: archive, checksums: checksums.toString("utf8") });
  verifyDownloadedAsset({ name: assets.manifest, content: manifestBytes, checksums: checksums.toString("utf8") });

  const manifest = parseManifestBytes(manifestBytes, assets.version);
  const sourceCommit = await client.resolveTagCommit(assets.tag);
  if (sourceCommit.toLowerCase() !== manifest.sourceCommit) {
    fail("stable_release_source_commit_mismatch");
  }

  const root = resolve(workspace);
  const downloads = join(root, "downloads");
  const extraction = join(root, "extracted");
  mkdirSync(downloads, { recursive: true, mode: 0o700 });
  mkdirSync(extraction, { recursive: true, mode: 0o700 });
  const archivePath = join(downloads, assets.archive);
  writeFileSync(archivePath, archive, { mode: 0o600, flag: "wx" });

  verifyReleaseAttestation({
    archivePath,
    tag: assets.tag,
    sourceCommit,
    ...(attestationRunner ? { runner: attestationRunner } : {}),
  });

  const extracted = extract({
    archive,
    manifest,
    manifestBytes,
    destination: extraction,
  });

  return {
    schemaVersion: 1,
    kind: "github-delivery/verified-release-payload",
    verified: true,
    source: extracted.root,
    archivePath,
    manifest,
    release: {
      tag: assets.tag,
      version: assets.version,
      sourceCommit: manifest.sourceCommit,
    },
    releaseMetadata: release,
  };
}

export async function prepareVerifiedReleaseCandidate({
  target,
  workspace,
  client = createGitHubReleaseClient(),
  attestationRunner = undefined,
  dependencies = {},
} = {}) {
  if (typeof target !== "string" || target.length === 0) fail("stable_release_target_invalid");
  if (typeof workspace !== "string" || workspace.length === 0) fail("stable_release_workspace_invalid");

  const acquire = dependencies.acquireVerifiedReleasePayload || acquireVerifiedReleasePayload;
  const plan = dependencies.planStableUpdate || planStableUpdate;
  const payload = await acquire({
    workspace,
    client,
    attestationRunner,
    dependencies,
  });
  if (!payload?.verified || !payload?.releaseMetadata) {
    fail("stable_release_candidate_invalid");
  }
  const updatePlan = plan({ releases: [payload.releaseMetadata], target });
  const { releaseMetadata, ...verifiedPayload } = payload;

  return {
    ...verifiedPayload,
    kind: "github-delivery/verified-release-candidate",
    plan: updatePlan,
  };
}

export const releaseSelfUpdateDefaults = Object.freeze({
  repository: DEFAULT_REPOSITORY,
  releaseWorkflow: RELEASE_WORKFLOW,
  maxRedirects: MAX_REDIRECTS,
  maxTagPeels: MAX_TAG_PEELS,
  downloadLimits: DOWNLOAD_LIMITS,
});
