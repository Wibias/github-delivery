import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  inspectWindowsInstallLocks,
  requestGracefulProcessClose,
} from "../../scripts/lib/windows-install-locks.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const STARTED = "2026-08-27T05:12:34.1234567Z";

test("lock inspection preserves stable process start identity", () => {
  const target = "C:\\Users\\ws\\.agents\\skills\\github-delivery";
  const blockers = inspectWindowsInstallLocks(target, {
    platform: "win32",
    spawn() {
      return {
        status: 0,
        stdout: JSON.stringify([
          {
            pid: 32616,
            name: "Cursor.exe",
            startTimeUtc: STARTED,
            paths: [`${target}\\scripts`],
          },
        ]),
        stderr: "",
      };
    },
  });
  assert.deepEqual(blockers, [{
    pid: 32616,
    name: "Cursor.exe",
    startTimeUtc: STARTED,
    paths: [`${target}\\scripts`],
  }]);
});

test("graceful close binds the request to the inspected process start identity", () => {
  const calls = [];
  const result = requestGracefulProcessClose({
    pid: 32616,
    name: "Cursor.exe",
    startTimeUtc: STARTED,
    paths: [],
  }, {
    platform: "win32",
    spawn(command, args) {
      calls.push([command, ...args]);
      return {
        status: 0,
        stdout: JSON.stringify({ requested: true, reason: null }),
        stderr: "",
      };
    },
  });
  assert.equal(result.requested, true);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes("-ExpectedStartTimeUtc"));
  assert.ok(calls[0].includes(STARTED));
});

test("graceful close refuses blockers without stable process identity", () => {
  let spawnCalls = 0;
  const result = requestGracefulProcessClose({
    pid: 32616,
    name: "Cursor.exe",
    paths: [],
  }, {
    platform: "win32",
    spawn() {
      spawnCalls += 1;
      throw new Error("must not spawn without process identity");
    },
  });
  assert.deepEqual(result, {
    requested: false,
    pid: 32616,
    reason: "process_identity_missing",
  });
  assert.equal(spawnCalls, 0);
});

test("PowerShell close path verifies start identity before CloseMainWindow", () => {
  const script = readFileSync(resolve(ROOT, "scripts/windows-install-locks.ps1"), "utf8");
  assert.match(script, /ExpectedStartTimeUtc/);
  assert.match(script, /process_identity_changed/);
  const identityCheck = script.indexOf("process_identity_changed");
  const close = script.indexOf("CloseMainWindow()");
  assert.ok(identityCheck >= 0 && close > identityCheck);
});
