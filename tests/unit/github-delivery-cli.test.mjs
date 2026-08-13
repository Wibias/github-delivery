import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  checkBootstrapEnvironment,
  discoverInstallations,
  parseBootstrapArgs,
} from "../../scripts/lib/bootstrap-cli.mjs";

function validManifest(version = "0.4.0") {
  return JSON.stringify({
    schemaVersion: 1,
    kind: "github-delivery/distribution-manifest",
    name: "github-delivery",
    version,
    sourceCommit: "a".repeat(40),
    files: [],
  });
}

function legacyFiles(target, version = "0.5.1") {
  return new Map([
    [join(target, "package.json"), JSON.stringify({ name: "github-delivery", version })],
    [join(target, "SKILL.md"), "---\nname: github-delivery\ndescription: legacy fixture\n---\n"],
    [join(target, "scripts", "install-skill.mjs"), "// legacy installer\n"],
  ]);
}

test("parses the public npx command surface and rejects unsafe v1 options", () => {
  assert.deepEqual(parseBootstrapArgs([]), {
    command: "guided",
    apply: false,
    target: null,
    help: false,
  });
  assert.deepEqual(parseBootstrapArgs(["install"]), {
    command: "install",
    apply: false,
    target: null,
    help: false,
  });
  assert.deepEqual(parseBootstrapArgs(["setup", "--target", "/tmp/custom"]), {
    command: "setup",
    apply: false,
    target: resolve("/tmp/custom"),
    help: false,
  });
  assert.deepEqual(parseBootstrapArgs(["update", "--apply"]), {
    command: "update",
    apply: true,
    target: null,
    help: false,
  });
  assert.deepEqual(parseBootstrapArgs(["doctor"]), {
    command: "doctor",
    apply: false,
    target: null,
    help: false,
  });
  assert.equal(parseBootstrapArgs(["--help"]).help, true);
  assert.equal(parseBootstrapArgs(["help"]).help, true);

  assert.throws(() => parseBootstrapArgs(["uninstall"]), /bootstrap_command_unknown/);
  assert.throws(() => parseBootstrapArgs(["install", "--yes"]), /bootstrap_option_unknown/);
  assert.throws(() => parseBootstrapArgs(["install", "--apply"]), /bootstrap_apply_update_only/);
  assert.throws(() => parseBootstrapArgs(["update", "--target"]), /bootstrap_target_missing/);
  assert.throws(() => parseBootstrapArgs(["doctor", "--wat"]), /bootstrap_option_unknown/);
});

test("environment checks are read-only and report Node, Git, gh, and gh auth", () => {
  const calls = [];
  const result = checkBootstrapEnvironment({
    nodeVersion: "v24.6.0",
    spawn(program, args) {
      calls.push([program, args]);
      if (program === "git") return { status: 0, stdout: "git version 2.50.0\n", stderr: "" };
      if (program === "gh" && args[0] === "--version") return { status: 0, stdout: "gh version 2.76.1\n", stderr: "" };
      if (program === "gh" && args[0] === "auth") return { status: 0, stdout: "", stderr: "logged in" };
      return { status: 1, stdout: "", stderr: "unexpected" };
    },
  });

  assert.deepEqual(result, {
    ok: true,
    node: { ok: true, version: "24.6.0" },
    git: { ok: true, detail: "git version 2.50.0" },
    gh: { ok: true, detail: "gh version 2.76.1" },
    ghAuth: { ok: true, detail: "logged in" },
  });
  assert.deepEqual(calls, [
    ["git", ["--version"]],
    ["gh", ["--version"]],
    ["gh", ["auth", "status"]],
  ]);
});

test("environment checks reject unsupported Node and never mutate authentication", () => {
  const calls = [];
  const result = checkBootstrapEnvironment({
    nodeVersion: "v23.1.0",
    spawn(program, args) {
      calls.push([program, args]);
      return { status: 127, stdout: "", stderr: `${program} missing` };
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.node, { ok: false, version: "23.1.0" });
  assert.equal(result.git.ok, false);
  assert.equal(result.gh.ok, false);
  assert.equal(result.ghAuth.ok, false);
  assert(!calls.some(([program, args]) => program === "gh" && args.includes("login")));
});

test("discovers valid installations from known skill locations and ignores missing candidates", () => {
  const home = resolve("/home/tester");
  const validAgent = join(home, ".agents", "skills", "github-delivery");
  const invalidCodex = join(home, ".codex", "skills", "github-delivery");
  const validCursor = join(home, ".cursor", "skills", "github-delivery");
  const files = new Map([
    [join(validAgent, "manifest.json"), validManifest("0.4.0")],
    [join(invalidCodex, "manifest.json"), JSON.stringify({ name: "something-else" })],
    [join(validCursor, "manifest.json"), validManifest("0.5.0")],
  ]);

  const found = discoverInstallations({
    home,
    exists(path) {
      return files.has(path);
    },
    readFile(path) {
      if (!files.has(path)) throw new Error("missing");
      return files.get(path);
    },
  });

  assert.deepEqual(found, [
    { target: validAgent, valid: true, version: "0.4.0", reason: null },
    { target: invalidCodex, valid: false, version: null, reason: "invalid_manifest" },
    { target: validCursor, valid: true, version: "0.5.0", reason: null },
  ]);
});

test("an explicit target is authoritative and duplicate resolved paths are deduplicated", () => {
  const explicit = resolve("/custom/github-delivery");
  const found = discoverInstallations({
    explicitTarget: explicit,
    home: explicit,
    exists(path) {
      return path === join(explicit, "manifest.json");
    },
    readFile() {
      return validManifest("0.4.0");
    },
  });

  assert.deepEqual(found, [
    { target: explicit, valid: true, version: "0.4.0", reason: null },
  ]);
});

test("recognizes a genuine pre-manifest GitHub Delivery installation as migratable", () => {
  const target = resolve("/custom/legacy-github-delivery");
  const files = legacyFiles(target, "0.5.1");
  const found = discoverInstallations({
    explicitTarget: target,
    exists(path) {
      return files.has(path);
    },
    readFile(path) {
      if (!files.has(path)) throw new Error("missing");
      return files.get(path);
    },
  });

  assert.deepEqual(found, [{
    target,
    valid: false,
    migratable: true,
    legacy: true,
    version: "0.5.1",
    reason: "legacy_manifestless",
  }]);
});

test("does not treat an arbitrary manifestless target as a legacy GitHub Delivery installation", () => {
  const target = resolve("/custom/not-github-delivery");
  const files = new Map([
    [join(target, "package.json"), JSON.stringify({ name: "something-else", version: "0.5.1" })],
    [join(target, "SKILL.md"), "---\nname: something-else\n---\n"],
  ]);
  const found = discoverInstallations({
    explicitTarget: target,
    exists(path) {
      return files.has(path);
    },
    readFile(path) {
      if (!files.has(path)) throw new Error("missing");
      return files.get(path);
    },
  });

  assert.deepEqual(found, [
    { target, valid: false, version: null, reason: "missing_manifest" },
  ]);
});
