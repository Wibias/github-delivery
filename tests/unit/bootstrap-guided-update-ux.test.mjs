import assert from "node:assert/strict";
import test from "node:test";

import { main } from "../../scripts/github-delivery-cli.mjs";

function writableBuffer() {
  let text = "";
  return {
    write(chunk) { text += String(chunk); },
    toString() { return text; },
  };
}

function blockedUpdatePlan() {
  return {
    schemaVersion: 1,
    kind: "github-delivery/stable-update-plan",
    source: "latest-stable-release",
    release: {
      tag: "v1.8.0",
      version: "1.8.0",
      sourceCommit: "a".repeat(40),
    },
    currentVersion: "1.7.1",
    target: "C:\\Users\\ws\\.agents\\skills\\github-delivery",
    localModifications: [{ path: "README.md", reason: "changed" }],
    blockingLocalModifications: [{ path: "README.md", reason: "changed" }],
    targetConvergedLocalModifications: [],
    safeToReplace: false,
    action: "blocked_local_modifications",
    assets: {
      tag: "v1.8.0",
      version: "1.8.0",
      archive: "github-delivery-v1.8.0.zip",
      manifest: "manifest.json",
      checksums: "SHA256SUMS",
    },
    apply: false,
    updated: false,
    verified: true,
    authorityHost: {
      action: "update",
      required: true,
      currentVersion: "1.7.0",
      targetVersion: "1.8.0",
    },
  };
}

test("bare guided update renders the stable update plan instead of raw JSON", async () => {
  const stdout = writableBuffer();
  await main([], {
    stdout,
    runBootstrap: async () => blockedUpdatePlan(),
  });

  const text = stdout.toString();
  assert.match(text, /GitHub Delivery update plan/i);
  assert.match(text, /1\.7\.1\s+.*1\.8\.0/);
  assert.match(text, /local modifications/i);
  assert.doesNotMatch(text, /^\s*\{/);
  assert.doesNotMatch(text, /"blockingLocalModifications"/);
});

test("blocked update explains the reviewed replacement command and backup behavior", async () => {
  const stdout = writableBuffer();
  await main(["update"], {
    stdout,
    runBootstrap: async () => blockedUpdatePlan(),
  });

  const text = stdout.toString();
  assert.match(text, /npx github-delivery update --apply --replace-local-modifications/i);
  assert.match(text, /backup/i);
});
