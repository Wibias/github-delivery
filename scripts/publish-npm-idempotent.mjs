#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

function run(npmCli, args, { allowNotFound = false } = {}) {
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status === 0) return String(result.stdout || "").trim();
  const detail = String(result.stderr || result.stdout || "").trim();
  if (allowNotFound && /\bE404\b|\b404\b|not found/i.test(detail)) return null;
  throw new Error(detail || `npm_command_failed:${result.status}`);
}

function parseIntegrity(output, code) {
  if (!output) return null;
  try {
    const value = JSON.parse(output);
    if (typeof value === "string" && value) return value;
    if (Array.isArray(value) && typeof value[0]?.integrity === "string") return value[0].integrity;
  } catch {
    if (/^sha\d+-/.test(output)) return output;
  }
  throw new Error(code);
}

export function localPackageIntegrity(npmCli) {
  const directory = mkdtempSync(join(tmpdir(), "github-delivery-npm-pack-"));
  try {
    const output = run(npmCli, [
      "pack",
      "--json",
      "--ignore-scripts",
      "--pack-destination",
      directory,
    ]);
    return parseIntegrity(output, "npm_pack_integrity_missing");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function publishedPackageIntegrity(npmCli, spec) {
  const output = run(
    npmCli,
    ["view", spec, "dist.integrity", "--json"],
    { allowNotFound: true },
  );
  return parseIntegrity(output, "npm_published_integrity_invalid");
}

export function publishNpmIdempotent({ npmCli, packageJsonPath = "package.json" }) {
  const packageJson = JSON.parse(readFileSync(resolve(packageJsonPath), "utf8"));
  const name = String(packageJson.name || "").trim();
  const version = String(packageJson.version || "").trim();
  if (!name || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error("npm_package_identity_invalid");
  }
  const spec = `${name}@${version}`;
  const localIntegrity = localPackageIntegrity(npmCli);
  const existingIntegrity = publishedPackageIntegrity(npmCli, spec);
  if (existingIntegrity) {
    if (existingIntegrity !== localIntegrity) {
      throw new Error(
        `npm_existing_version_integrity_mismatch:${spec}: expected ${localIntegrity}, observed ${existingIntegrity}`,
      );
    }
    return { spec, status: "already_published", integrity: localIntegrity };
  }

  run(npmCli, ["publish", "--access", "public"]);
  const publishedIntegrity = publishedPackageIntegrity(npmCli, spec);
  if (!publishedIntegrity || publishedIntegrity !== localIntegrity) {
    throw new Error(
      `npm_publish_verification_failed:${spec}: expected ${localIntegrity}, observed ${publishedIntegrity || "missing"}`,
    );
  }
  return { spec, status: "published", integrity: localIntegrity };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const npmCli = process.argv[2];
  if (!npmCli) {
    console.error("Usage: node scripts/publish-npm-idempotent.mjs <npm-cli.js>");
    process.exit(2);
  }
  try {
    process.stdout.write(`${JSON.stringify(publishNpmIdempotent({ npmCli: resolve(npmCli) }), null, 2)}\n`);
  } catch (error) {
    console.error(String(error?.message || error));
    process.exit(2);
  }
}
