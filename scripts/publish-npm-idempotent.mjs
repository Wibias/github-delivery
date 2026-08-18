#!/usr/bin/env node
import { boundedSpawnSync } from "./lib/subprocess-policy.mjs";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_PUBLISH_VERIFY_DELAYS_MS = Object.freeze([
  1_000,
  2_000,
  4_000,
  8_000,
  15_000,
  30_000,
]);

const SLEEP_SIGNAL = new Int32Array(new SharedArrayBuffer(4));

function sleepSync(milliseconds) {
  Atomics.wait(SLEEP_SIGNAL, 0, 0, milliseconds);
}

function run(npmCli, args, { allowNotFound = false } = {}) {
  const result = boundedSpawnSync(process.execPath, [npmCli, ...args], {
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

function publishVerificationError(spec, expectedIntegrity, observedIntegrity) {
  return new Error(
    `npm_publish_verification_failed:${spec}: expected ${expectedIntegrity}, observed ${observedIntegrity || "missing"}`,
  );
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

export function verifyPublishedPackageIntegrity({
  npmCli,
  spec,
  expectedIntegrity,
  delaysMs = DEFAULT_PUBLISH_VERIFY_DELAYS_MS,
  sleep = sleepSync,
  lookup = publishedPackageIntegrity,
}) {
  let observedIntegrity = lookup(npmCli, spec);
  if (observedIntegrity === expectedIntegrity) return observedIntegrity;
  if (observedIntegrity) {
    throw publishVerificationError(spec, expectedIntegrity, observedIntegrity);
  }

  for (const delayMs of delaysMs) {
    sleep(delayMs);
    observedIntegrity = lookup(npmCli, spec);
    if (observedIntegrity === expectedIntegrity) return observedIntegrity;
    if (observedIntegrity) {
      throw publishVerificationError(spec, expectedIntegrity, observedIntegrity);
    }
  }

  throw publishVerificationError(spec, expectedIntegrity, null);
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

  run(npmCli, ["publish", "--access", "public", "--ignore-scripts"]);
  verifyPublishedPackageIntegrity({
    npmCli,
    spec,
    expectedIntegrity: localIntegrity,
  });
  return { spec, status: "published", integrity: localIntegrity };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
const modulePath = resolve(fileURLToPath(import.meta.url));
if (invokedPath && invokedPath === modulePath) {
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
