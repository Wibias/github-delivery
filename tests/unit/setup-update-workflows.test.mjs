import assert from "node:assert/strict";
import test from "node:test";

import { runConfigCommand } from "../../scripts/lib/config-command.mjs";
import {
  compareInstalledManifest,
  selectStableRelease,
} from "../../scripts/lib/stable-release-update.mjs";
import { routeShippingGithubPrompt } from "../../scripts/lib/skill-router.mjs";
import { runUpdateCommand } from "../../scripts/update-skill.mjs";

const config = { schemaVersion: 1, authorityMode: "off" };

test("config command shows and updates the canonical config", () => {
  let written = null;
  const shown = runConfigCommand({ argv: ["--show"], env: {}, dependencies: {
    readUserConfig: () => ({ path: "/cfg/config.json", source: "file", config }),
    writeUserConfig: () => { throw new Error("show must not write"); },
  }});
  assert.equal(shown.config.authorityMode, "off");
  assert.equal(shown.effectiveAuthorityMode, "off");

  const changed = runConfigCommand({ argv: ["--authority-mode", "all"], env: {}, dependencies: {
    readUserConfig: () => ({ path: "/cfg/config.json", source: "file", config }),
    writeUserConfig: (value) => { written = value; return { path: "/cfg/config.json", config: value }; },
  }});
  assert.equal(written.authorityMode, "all");
  assert.equal(changed.config.authorityMode, "all");
});

test("latest update source accepts stable releases only", () => {
  assert.equal(selectStableRelease([
    { tag_name: "v2.0.0-beta.1", draft: false, prerelease: true },
    { tag_name: "v1.4.0", draft: false, prerelease: false },
    { tag_name: "v1.3.0", draft: false, prerelease: false },
  ]).tag_name, "v1.4.0");
  assert.throws(() => selectStableRelease([]), /stable_release_not_found/);
  assert.throws(() => selectStableRelease([{ tag_name: "v2.0.0-rc.1", prerelease: true }]), /stable_release_not_found/);
});

test("installed manifest comparison detects changed and missing tracked files", () => {
  const manifest = { schemaVersion: 1, kind: "github-delivery/distribution-manifest", files: [
    { path: "SKILL.md", mode: "0644", sha256: "a".repeat(64) },
    { path: "references/status.md", mode: "0644", sha256: "b".repeat(64) },
  ]};
  const result = compareInstalledManifest({ manifest, target: "/skill", dependencies: {
    lstat: (path) => {
      if (String(path).endsWith("status.md")) {
        const error = new Error("ENOENT");
        error.code = "ENOENT";
        throw error;
      }
      return {
        isFile: () => true,
        isSymbolicLink: () => false,
        isDirectory: () => false,
        mode: 0o100644,
      };
    },
    readFile: () => Buffer.from("locally changed"),
    sha256: () => "c".repeat(64),
  }});
  assert.deepEqual(result.modifications.map((item) => item.reason).sort(), ["changed", "missing"]);
  assert.equal(result.clean, false);
});

test("natural language routes setup, settings, and stable update", () => {
  assert.equal(routeShippingGithubPrompt("set up github-delivery for me")?.workflow, "references/configuration.md");
  assert.equal(routeShippingGithubPrompt("show me my github-delivery settings and let me change them")?.workflow, "references/configuration.md");
  assert.equal(routeShippingGithubPrompt("update github-delivery to the latest stable release")?.workflow, "references/update.md");
});

test("legacy updater delegates to the shared installer update mode", async () => {
  let forwarded = null;
  const result = await runUpdateCommand(["--target", "/custom/skill", "--apply"], {
    installMain: async (argv) => {
      forwarded = argv;
      return { action: "update", updated: true };
    },
  });

  assert.deepEqual(forwarded, ["--update", "--target", "/custom/skill", "--apply"]);
  assert.deepEqual(result, { action: "update", updated: true });
});
