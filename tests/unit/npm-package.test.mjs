import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { parseNpmPackJson } from "../../scripts/lib/npm-pack-json.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

const REQUIRED_RUNTIME = new Set([
  "scripts/github-delivery-cli.mjs",
  "scripts/install-codex-watchdog-hooks.mjs",
  "scripts/install-skill.mjs",
  "scripts/lib/authority-host-client.mjs",
  "scripts/lib/authority-host-install.mjs",
  "scripts/lib/authority-host-release.mjs",
  "scripts/lib/bootstrap-cli.mjs",
  "scripts/lib/bootstrap-command.mjs",
  "scripts/lib/bootstrap-install.mjs",
  "scripts/lib/bootstrap-maintenance.mjs",
  "scripts/lib/distribution.mjs",
  "scripts/lib/release-self-update.mjs",
  "scripts/lib/subprocess-policy.mjs",
  "scripts/lib/release-zip.mjs",
  "scripts/lib/stable-release-update.mjs",
  "scripts/lib/user-config.mjs",
  "scripts/lib/watchdog-activation.mjs",
]);

const ALWAYS_ALLOWED = new Set([
  "LICENSE",
  "README.md",
  "package.json",
]);

function runNpm(args, cwd = ROOT) {
  return spawnSync(NPM, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      npm_config_audit: "false",
      npm_config_fund: "false",
    },
  });
}

function dryRunPack() {
  const result = runNpm(["pack", "--dry-run", "--json", "--ignore-scripts"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const [pack] = parseNpmPackJson(result.stdout);
  assert(pack, "npm pack returned no package metadata");
  return pack;
}

test("npm pack parser accepts npm 11 array and npm 12 keyed-object output", () => {
  const pack = {
    name: "github-delivery",
    version: "0.5.0",
    files: [{ path: "package.json" }],
  };
  assert.deepEqual(parseNpmPackJson(JSON.stringify([pack])), [pack]);
  assert.deepEqual(parseNpmPackJson(JSON.stringify({ "github-delivery": pack })), [pack]);
});

test("package metadata exposes only the supported public npx bootstrap", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

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
    assert.equal(pkg.scripts?.[key], undefined, `${key} lifecycle script must not exist`);
  }
  assert.equal(pkg.scripts?.["package:check"], "node scripts/validate-npm-package.mjs");
  assert.match(pkg.scripts?.check || "", /package:check/);
});

test("npm pack contains only bootstrap runtime files plus npm's mandatory docs/metadata", () => {
  const pack = dryRunPack();
  const paths = new Set(pack.files.map((entry) => entry.path));

  for (const path of [...REQUIRED_RUNTIME, ...ALWAYS_ALLOWED]) {
    assert(paths.has(path), `missing packed path: ${path}`);
  }
  for (const path of paths) {
    assert(
      REQUIRED_RUNTIME.has(path) || ALWAYS_ALLOWED.has(path),
      `unexpected packed path: ${path}`,
    );
  }
});

test("repository package validator accepts the exact packed bootstrap surface", () => {
  const result = spawnSync(process.execPath, [join(ROOT, "scripts", "validate-npm-package.mjs")], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("a real packed tarball runs --help after an offline local install", () => {
  const root = mkdtempSync(join(tmpdir(), "github-delivery-npm-package-test-"));
  try {
    const packDir = join(root, "pack");
    const installDir = join(root, "install");
    mkdirSync(packDir, { recursive: true });
    writeFileSync(join(root, "package.json"), "{}\n", "utf8");

    const packResult = runNpm([
      "pack",
      "--json",
      "--ignore-scripts",
      "--pack-destination",
      packDir,
    ]);
    assert.equal(packResult.status, 0, packResult.stderr || packResult.stdout);
    const [pack] = parseNpmPackJson(packResult.stdout);
    const tarball = join(packDir, pack.filename);

    const installResult = runNpm([
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      "--prefix",
      installDir,
      tarball,
    ], root);
    assert.equal(installResult.status, 0, installResult.stderr || installResult.stdout);

    const cli = join(
      installDir,
      "node_modules",
      "github-delivery",
      "scripts",
      "github-delivery-cli.mjs",
    );
    const help = spawnSync(process.execPath, [cli, "--help"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(help.status, 0, help.stderr || help.stdout);
    assert.match(help.stdout, /github-delivery update/);
    assert.match(help.stdout, /guided setup/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
