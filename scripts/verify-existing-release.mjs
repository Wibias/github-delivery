#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readRelease(repo, tag) {
  const result = spawnSync("gh", ["api", `repos/${repo}/releases/tags/${tag}`], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new Error(detail || `release_lookup_failed:${result.status}`);
  }
  try {
    const payload = JSON.parse(String(result.stdout || "{}"));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("not_object");
    return payload;
  } catch {
    throw new Error("release_lookup_invalid_json");
  }
}

export function verifyExistingRelease({ repo, tag, files, release = null }) {
  if (!repo || !tag || !Array.isArray(files) || files.length === 0) {
    throw new Error("release_verification_arguments_invalid");
  }
  const payload = release || readRelease(repo, tag);
  if (payload.tag_name !== tag) throw new Error("release_tag_mismatch");
  if (payload.draft === true) throw new Error("release_is_draft");

  const assets = new Map((payload.assets || []).map((asset) => [asset.name, asset]));
  const verified = [];
  for (const file of files) {
    const name = basename(file);
    const asset = assets.get(name);
    if (!asset) throw new Error(`release_asset_missing:${name}`);
    const expected = `sha256:${sha256File(file)}`;
    if (asset.digest !== expected) {
      throw new Error(
        `release_asset_digest_mismatch:${name}: expected ${expected}, observed ${asset.digest || "missing"}`,
      );
    }
    verified.push({ name, digest: expected });
  }
  return { tag, status: "verified_existing_release", assets: verified };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
const modulePath = resolve(fileURLToPath(import.meta.url));
if (invokedPath && invokedPath === modulePath) {
  const [repo, tag, ...files] = process.argv.slice(2);
  try {
    process.stdout.write(`${JSON.stringify(verifyExistingRelease({ repo, tag, files }), null, 2)}\n`);
  } catch (error) {
    console.error(String(error?.message || error));
    process.exit(2);
  }
}
