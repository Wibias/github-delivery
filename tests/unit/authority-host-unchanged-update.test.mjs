import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { reconcileStableAuthorityHost } from "../../scripts/lib/authority-host-install.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("stable update skips Authority replacement when verified program payload is unchanged", async () => {
  const home = mkdtempSync(join(tmpdir(), "gd-authority-unchanged-"));
  const root = join(home, "GitHubDeliveryAuthority");
  const app = join(root, "app", "v1.4.4");
  mkdirSync(app, { recursive: true });

  const exe = Buffer.from("same executable bytes");
  const dll = Buffer.from("same library bytes");
  const oldVersion = Buffer.from('{"version":"1.4.4"}\n');
  const newVersion = Buffer.from('{"version":"1.4.5"}\n');
  writeFileSync(join(app, "GitHubDeliveryAuthority.exe"), exe);
  writeFileSync(join(app, "GitHubDeliveryAuthority.dll"), dll);
  writeFileSync(join(app, "authority-host-version.json"), oldVersion);

  const expectedRelease = {
    tag: "v1.4.5",
    version: "1.4.5",
    sourceCommit: "b".repeat(40),
  };
  const installed = {
    supported: true,
    configured: true,
    installed: true,
    legacy: false,
    root,
    exePath: join(app, "GitHubDeliveryAuthority.exe"),
    version: "1.4.4",
    sourceCommit: "a".repeat(40),
  };
  let installCalls = 0;

  try {
    const result = await reconcileStableAuthorityHost({
      expectedRelease,
      platform: "win32",
      env: { LOCALAPPDATA: home },
      home,
      client: {
        async latestRelease() { return { tag_name: expectedRelease.tag }; },
      },
      dependencies: {
        readUserConfig: () => ({ config: { schemaVersion: 1, authorityMode: "all" } }),
        readInstalledAuthorityHost: () => installed,
        makeWorkspace: () => join(home, "workspace"),
        removeWorkspace() {},
        acquireVerifiedAuthorityHostPayload: async () => ({
          schemaVersion: 1,
          kind: "github-delivery/verified-authority-host-payload",
          verified: true,
          source: join(home, "candidate"),
          metadata: {
            version: expectedRelease.version,
            sourceCommit: expectedRelease.sourceCommit,
            files: [
              { path: "GitHubDeliveryAuthority.exe", bytes: exe.length, sha256: sha256(exe) },
              { path: "GitHubDeliveryAuthority.dll", bytes: dll.length, sha256: sha256(dll) },
              { path: "authority-host-version.json", bytes: newVersion.length, sha256: sha256(newVersion) },
            ],
          },
        }),
        installVerifiedAuthorityHost() {
          installCalls += 1;
          throw new Error("unchanged Authority payload must not be installed");
        },
      },
    });

    assert.equal(installCalls, 0);
    assert.equal(result.action, "unchanged_content");
    assert.equal(result.required, false);
    assert.equal(result.changed, false);
    assert.equal(result.currentVersion, "1.4.4");
    assert.equal(result.targetVersion, "1.4.5");
    assert.equal(result.installed, installed);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
