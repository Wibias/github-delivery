import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { resolveNpmCli } from "../../scripts/lib/npm-cli.mjs";

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "github-delivery-npm-cli-"));
  mkdirSync(join(root, "bin"), { recursive: true });
  return root;
}

test("resolveNpmCli prefers a JavaScript npm_execpath", () => {
  const root = fixtureRoot();
  const npmExecPath = join(root, "npm-cli.js");
  writeFileSync(npmExecPath, "console.log('npm');\n");
  assert.equal(
    resolveNpmCli({
      execPath: join(root, "bin", "node"),
      env: { npm_execpath: npmExecPath },
    }),
    npmExecPath,
  );
});

test("resolveNpmCli skips a cmd shim and uses the node-adjacent JavaScript CLI", () => {
  const root = fixtureRoot();
  const execPath = join(root, "node.exe");
  const adjacent = join(root, "node_modules", "npm", "bin", "npm-cli.js");
  mkdirSync(dirname(adjacent), { recursive: true });
  writeFileSync(join(root, "npm.cmd"), "@echo off\n");
  writeFileSync(adjacent, "console.log('npm');\n");
  assert.equal(
    resolveNpmCli({
      execPath,
      env: { npm_execpath: join(root, "npm.cmd") },
    }),
    adjacent,
  );
});

test("resolveNpmCli uses the Unix lib layout when the Windows layout is absent", () => {
  const root = fixtureRoot();
  const execPath = join(root, "bin", "node");
  const unix = join(root, "lib", "node_modules", "npm", "bin", "npm-cli.js");
  mkdirSync(dirname(unix), { recursive: true });
  writeFileSync(unix, "console.log('npm');\n");
  assert.equal(
    resolveNpmCli({
      execPath,
      env: {},
    }),
    unix,
  );
});

test("resolveNpmCli fails closed when no JavaScript npm CLI exists", () => {
  const root = fixtureRoot();
  assert.throws(
    () =>
      resolveNpmCli({
        execPath: join(root, "node"),
        env: { npm_execpath: join(root, "npm.cmd") },
      }),
    /npm_cli_unreadable/,
  );
});
