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

function expectedRelease() {
  return {
    tag: "v1.4.5",
    version: "1.4.5",
    sourceCommit: "b".repeat(40),
  };
}

function installedAuthority({ root, app }) {
  return {
    supported: true,
    configured: true,
    installed: true,
    legacy: false,
    root,
    exePath: join(app, "GitHubDeliveryAuthority.exe"),
    version: "1.4.4",
    sourceCommit: "a".repeat(40),
  };
}

function verifiedPayload({ home, release, exe, dll }) {
  const newVersion = Buffer.from('{"version":"1.4.5"}\n');
  return {
    schemaVersion: 1,
    kind: "github-delivery/verified-authority-host-payload",
    verified: true,
    source: join(home, "candidate"),
    metadata: {
      version: release.version,
      sourceCommit: release.sourceCommit,
      files: [
        { path: "GitHubDeliveryAuthority.exe", bytes: exe.length, sha256: sha256(exe) },
        { path: "GitHubDeliveryAuthority.dll", bytes: dll.length, sha256: sha256(dll) },
        { path: "authority-host-version.json", bytes: newVersion.length, sha256: sha256(newVersion) },
      ],
    },
  };
}

test("stable update skips Authority replacement when verified program payload is unchanged", async () => {
  const home = mkdtempSync(join(tmpdir(), "gd-authority-unchanged-"));
  const root = join(home, "GitHubDeliveryAuthority");
  const app = join(root, "app", "v1.4.4");
  mkdirSync(app, { recursive: true });

  const exe = Buffer.from("same executable bytes");
  const dll = Buffer.from("same library bytes");
  writeFileSync(join(app, "GitHubDeliveryAuthority.exe"), exe);
  writeFileSync(join(app, "GitHubDeliveryAuthority.dll"), dll);
  writeFileSync(join(app, "authority-host-version.json"), '{"version":"1.4.4"}\n');

  const release = expectedRelease();
  const installed = installedAuthority({ root, app });
  let installCalls = 0;

  try {
    const result = await reconcileStableAuthorityHost({
      expectedRelease: release,
      platform: "win32",
      env: { LOCALAPPDATA: home },
      home,
      client: {
        async latestRelease() { return { tag_name: release.tag }; },
      },
      dependencies: {
        readUserConfig: () => ({ config: { schemaVersion: 1, authorityMode: "all" } }),
        readInstalledAuthorityHost: () => installed,
        makeWorkspace: () => join(home, "workspace"),
        removeWorkspace() {},
        acquireVerifiedAuthorityHostPayload: async () => verifiedPayload({ home, release, exe, dll }),
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

test("stable update still replaces Authority when a verified program file changed", async () => {
  const home = mkdtempSync(join(tmpdir(), "gd-authority-changed-"));
  const root = join(home, "GitHubDeliveryAuthority");
  const app = join(root, "app", "v1.4.4");
  mkdirSync(app, { recursive: true });

  const installedExe = Buffer.from("old executable bytes");
  const candidateExe = Buffer.from("new executable bytes");
  const dll = Buffer.from("same library bytes");
  writeFileSync(join(app, "GitHubDeliveryAuthority.exe"), installedExe);
  writeFileSync(join(app, "GitHubDeliveryAuthority.dll"), dll);
  writeFileSync(join(app, "authority-host-version.json"), '{"version":"1.4.4"}\n');

  const release = expectedRelease();
  const installed = installedAuthority({ root, app });
  const after = {
    ...installed,
    exePath: join(root, "app", "v1.4.5", "GitHubDeliveryAuthority.exe"),
    version: release.version,
    sourceCommit: release.sourceCommit,
  };
  let reads = 0;
  let installCalls = 0;

  try {
    const result = await reconcileStableAuthorityHost({
      expectedRelease: release,
      platform: "win32",
      env: { LOCALAPPDATA: home },
      home,
      client: {
        async latestRelease() { return { tag_name: release.tag }; },
      },
      dependencies: {
        readUserConfig: () => ({ config: { schemaVersion: 1, authorityMode: "all" } }),
        readInstalledAuthorityHost: () => (reads++ === 0 ? installed : after),
        makeWorkspace: () => join(home, "workspace"),
        removeWorkspace() {},
        acquireVerifiedAuthorityHostPayload: async () => verifiedPayload({ home, release, exe: candidateExe, dll }),
        installVerifiedAuthorityHost() {
          installCalls += 1;
          return { installed: true, version: release.version, sourceCommit: release.sourceCommit };
        },
      },
    });

    assert.equal(installCalls, 1);
    assert.equal(result.action, "update");
    assert.equal(result.required, true);
    assert.equal(result.changed, true);
    assert.equal(result.installed, after);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
