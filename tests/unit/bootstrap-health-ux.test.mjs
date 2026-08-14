import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { main } from "../../scripts/github-delivery-cli.mjs";
import { checkBootstrapEnvironment, parseBootstrapArgs } from "../../scripts/lib/bootstrap-cli.mjs";
import { runGuidedInstall } from "../../scripts/lib/bootstrap-install.mjs";

function writableBuffer() {
  let text = "";
  return {
    write(chunk) {
      text += String(chunk);
    },
    toString() {
      return text;
    },
  };
}

function healthySpawn(program, args) {
  if (program === "git") return { status: 0, stdout: "git version 2.55.0\n", stderr: "" };
  if (program === "gh" && args[0] === "--version") return { status: 0, stdout: "gh version 2.97.0\n", stderr: "" };
  if (program === "gh" && args[0] === "auth") return { status: 0, stdout: "logged in", stderr: "" };
  return { status: 1, stdout: "", stderr: "unexpected" };
}

function verifiedPayload(workspace) {
  return {
    schemaVersion: 1,
    kind: "github-delivery/verified-release-payload",
    verified: true,
    source: resolve(workspace, "extracted", "github-delivery"),
    manifest: {
      schemaVersion: 1,
      kind: "github-delivery/distribution-manifest",
      name: "github-delivery",
      version: "0.5.2",
      sourceCommit: "a".repeat(40),
      files: [],
    },
    release: { tag: "v0.5.2", version: "0.5.2", sourceCommit: "a".repeat(40) },
  };
}

test("Node 26 is a supported bootstrap runtime", () => {
  const result = checkBootstrapEnvironment({ nodeVersion: "v26.7.0", spawn: healthySpawn });
  assert.equal(result.ok, true);
  assert.deepEqual(result.node, { ok: true, version: "26.7.0" });
});

test("doctor accepts --json as an explicit machine-readable compatibility mode", () => {
  assert.deepEqual(parseBootstrapArgs(["doctor", "--json"]), {
    command: "doctor",
    apply: false,
    target: null,
    help: false,
    json: true,
  });
});

test("guided install fails before release acquisition when environment preflight is unhealthy", async () => {
  let acquired = 0;
  const output = writableBuffer();
  await assert.rejects(
    runGuidedInstall({
      target: resolve("/tmp/github-delivery-health-preflight"),
      output,
      dependencies: {
        discoverInstallations: () => [],
        checkBootstrapEnvironment: () => ({
          ok: false,
          node: { ok: false, version: "27.0.0" },
          git: { ok: true, detail: "git available" },
          gh: { ok: true, detail: "gh available" },
          ghAuth: { ok: true, detail: "logged in" },
        }),
        async acquireVerifiedReleasePayload() {
          acquired += 1;
          throw new Error("must not acquire release after failed preflight");
        },
      },
    }),
    /bootstrap_environment_invalid/,
  );
  assert.equal(acquired, 0);
  assert.match(output.toString(), /Environment check/);
  assert.match(output.toString(), /Node\.js 27\.0\.0/);
  assert.match(output.toString(), /not supported/i);
});

test("guided install reports unverified hook trust without claiming Codex still requires trust", async () => {
  const output = writableBuffer();
  const target = resolve("/tmp/github-delivery-health-postflight");
  await runGuidedInstall({
    target,
    output,
    dependencies: {
      discoverInstallations: () => [],
      checkBootstrapEnvironment: () => ({
        ok: true,
        node: { ok: true, version: "26.7.0" },
        git: { ok: true, detail: "git available" },
        gh: { ok: true, detail: "gh available" },
        ghAuth: { ok: true, detail: "logged in" },
      }),
      makeWorkspace: () => "/tmp/github-delivery-health-workspace",
      removeWorkspace() {},
      async acquireVerifiedReleasePayload({ workspace }) {
        return verifiedPayload(workspace);
      },
      installSkill(options) {
        return {
          action: "install",
          apply: options.apply,
          target,
          backupPath: null,
          watchdog: options.apply
            ? { mode: "none", hookTrustRequired: true, hooksConfigured: true, hookTrustVerified: false }
            : { mode: "none", hookTrustRequired: false },
        };
      },
      readUserConfig: () => ({ config: { schemaVersion: 1, authorityMode: "off" } }),
      verifyInstalledRelease: () => ({ clean: true, modifications: [] }),
      reconcileStableAuthorityHost: async () => ({ action: "unsupported", changed: false }),
      confirmApply: async () => true,
    },
  });

  const text = output.toString();
  assert.match(text, /loop interruption.*not active/i);
  assert.match(text, /has not verified Codex hook trust/i);
  assert.match(text, /already trusted in Codex/i);
  assert.match(text, /if needed.*\/hooks/i);
  assert.match(text, /github-delivery setup/);
  assert.doesNotMatch(text, /still require trust/i);
});

test("doctor prints an actionable human health summary by default", async () => {
  const stdout = writableBuffer();
  const report = {
    action: "doctor",
    environment: {
      ok: true,
      node: { ok: true, version: "26.7.0" },
      git: { ok: true, detail: "git available" },
      gh: { ok: true, detail: "gh available" },
      ghAuth: { ok: true, detail: "logged in" },
    },
    target: "C:\\Users\\ws\\.agents\\skills\\github-delivery",
    installed: { ok: true, version: "0.5.2" },
    integrity: { ok: true, clean: true, modifications: [], error: null },
    config: { ok: true, source: "default", effectiveAuthorityMode: "off", error: null },
    authorityHost: { ok: true, supported: true, installed: false, legacy: false, version: null, relation: "missing", requiredByMode: false, error: null },
    activation: {
      mode: "none",
      degradationReason: "hook_trust_required",
      hooksConfigured: true,
      hookTrustVerified: false,
    },
    latest: { version: "0.5.2", relation: "already_current", error: null },
  };

  await main(["doctor"], {
    stdout,
    runBootstrap: async () => report,
  });

  const text = stdout.toString();
  assert.match(text, /GitHub Delivery Doctor/);
  assert.match(text, /Node\s+.*26\.7\.0/);
  assert.match(text, /Integrity\s+.*Clean/i);
  assert.match(text, /LOOP INTERRUPTION NOT ACTIVE/);
  assert.match(text, /has not verified Codex hook trust/i);
  assert.match(text, /already trusted in Codex/i);
  assert.match(text, /if needed.*\/hooks/i);
  assert.match(text, /github-delivery setup/);
  assert.doesNotMatch(text, /still require trust/i);
  assert.doesNotMatch(text, /^\s*\{/);
});

test("doctor explains how to migrate a recognized legacy manifestless installation", async () => {
  const stdout = writableBuffer();
  const report = {
    action: "doctor",
    environment: {
      ok: true,
      node: { ok: true, version: "26.7.0" },
      git: { ok: true },
      gh: { ok: true },
      ghAuth: { ok: true },
    },
    target: "C:\\Users\\ws\\.agents\\skills\\github-delivery",
    installed: { ok: true, version: "0.5.1", legacyManifestless: true },
    integrity: { ok: false, clean: null, modifications: [], error: "legacy_manifest_missing" },
    config: { ok: true, source: "default", effectiveAuthorityMode: "off", error: null },
    authorityHost: { ok: true, supported: true, installed: false, legacy: false, version: null, relation: "missing", requiredByMode: false, error: null },
    activation: null,
    latest: { version: "0.5.2", relation: "update", error: null },
  };

  await main(["doctor"], {
    stdout,
    runBootstrap: async () => report,
  });

  const text = stdout.toString();
  assert.match(text, /Legacy.*manifest missing/i);
  assert.match(text, /Integrity\s+.*Unknown/i);
  assert.match(text, /migration.*available/i);
  assert.match(text, /github-delivery update --apply/i);
});

test("doctor --json preserves the existing raw report output", async () => {
  const stdout = writableBuffer();
  const report = { action: "doctor", environment: { ok: true }, installed: { ok: true, version: "0.5.2" } };

  await main(["doctor", "--json"], {
    stdout,
    runBootstrap: async () => report,
  });

  assert.deepEqual(JSON.parse(stdout.toString()), report);
});

test("install renders a concise success summary instead of the internal receipt", async () => {
  const stdout = writableBuffer();
  await main(["install"], {
    stdout,
    runBootstrap: async () => ({
      action: "install",
      apply: true,
      installed: true,
      verified: true,
      sourceVersion: "0.6.0",
      target: "C:\\Users\\ws\\.agents\\skills\\github-delivery",
      watchdog: { mode: "hooks", hookTrustVerified: true },
      authorityHost: { changed: true, installed: { version: "0.6.0" } },
    }),
  });

  const text = stdout.toString();
  assert.match(text, /GitHub Delivery installed successfully/i);
  assert.match(text, /Authority GUI is installed/i);
  assert.match(text, /npx github-delivery start/i);
  assert.doesNotMatch(text, /^\s*\{/);
});

test("setup renders readiness and start guidance instead of the internal receipt", async () => {
  const stdout = writableBuffer();
  await main(["setup"], {
    stdout,
    runBootstrap: async () => ({
      action: "setup",
      status: "ready",
      target: "C:\\Users\\ws\\.agents\\skills\\github-delivery",
      watchdog: "hooks",
      authorityHost: { changed: false, installed: { version: "0.6.0" } },
    }),
  });

  const text = stdout.toString();
  assert.match(text, /GitHub Delivery setup complete/i);
  assert.match(text, /npx github-delivery start/i);
  assert.doesNotMatch(text, /^\s*\{/);
});
