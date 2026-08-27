#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { boundedSpawnSync } from "./lib/subprocess-policy.mjs";
import { fileURLToPath } from "node:url";

import { resolveNpmCli } from "./lib/npm-cli.mjs";
import { parseNpmPackJson } from "./lib/npm-pack-json.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

const RUNTIME_FILES = [
  "scripts/github-delivery-cli.mjs",
  "scripts/install-codex-watchdog-hooks.mjs",
  "scripts/install-skill.mjs",
  "scripts/windows-install-locks.ps1",
  "scripts/lib/authority-host-client.mjs",
  "scripts/lib/authority-host-install.mjs",
  "scripts/lib/authority-host-release.mjs",
  "scripts/lib/bootstrap-cli.mjs",
  "scripts/lib/bootstrap-command.mjs",
  "scripts/lib/bootstrap-install.mjs",
  "scripts/lib/bootstrap-maintenance.mjs",
  "scripts/lib/distribution.mjs",
  "scripts/lib/install-lock.mjs",
  "scripts/lib/installation-backups.mjs",
  "scripts/lib/release-path-identity.mjs",
  "scripts/lib/release-self-update.mjs",
  "scripts/lib/subprocess-policy.mjs",
  "scripts/lib/release-zip.mjs",
  "scripts/lib/stable-release-update.mjs",
  "scripts/lib/update-user-experience.mjs",
  "scripts/lib/user-config.mjs",
  "scripts/lib/watchdog-activation.mjs",
  "scripts/lib/windows-install-locks.mjs",
];

const PACKED_DOCS = ["LICENSE", "README.md", "package.json"];

function fail(message) {
  process.stderr.write(`npm_package_invalid:${message}\n`);
  process.exit(1);
}

function sameStrings(actual, expected) {
  return actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

try {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.name, "github-delivery");
  assert.equal(pkg.private, undefined);
  assert.deepEqual(pkg.bin, {
    "github-delivery": "scripts/github-delivery-cli.mjs",
  });
  assert.equal(pkg.license, "MIT");
  assert.deepEqual(pkg.repository, {
    type: "git",
    url: "git+https://github.com/Wibias/github-delivery.git",
  });
  assert.equal(pkg.publishConfig?.access, "public");
  assert.equal(pkg.publishConfig?.registry, "https://registry.npmjs.org/");
  assert.equal(pkg.dependencies, undefined);
  for (const key of ["preinstall", "install", "postinstall"]) {
    assert.equal(pkg.scripts?.[key], undefined);
  }

  const declaredFiles = [...(pkg.files || [])].sort();
  const expectedRuntime = [...RUNTIME_FILES].sort();
  assert(sameStrings(declaredFiles, expectedRuntime), "package files allowlist drifted");
  for (const path of RUNTIME_FILES) {
    assert(existsSync(resolve(ROOT, path)), `missing runtime file: ${path}`);
  }

  const packResult = boundedSpawnSync(
    process.execPath,
    [resolveNpmCli(), "pack", "--dry-run", "--json", "--ignore-scripts"],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        npm_config_audit: "false",
        npm_config_fund: "false",
      },
    },
  );
  assert.equal(packResult.status, 0, packResult.stderr || packResult.stdout);
  const [pack] = parseNpmPackJson(packResult.stdout);
  assert(pack, "npm pack returned no package metadata");

  const actual = pack.files.map((entry) => entry.path).sort();
  const expected = [...RUNTIME_FILES, ...PACKED_DOCS].sort();
  assert(sameStrings(actual, expected), `packed surface drifted: ${actual.join(",")}`);

  process.stdout.write(`npm package valid: ${pack.name}@${pack.version} (${actual.length} files)\n`);
} catch (error) {
  fail(error?.message || String(error));
}
