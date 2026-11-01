import assert from "node:assert/strict";
import test from "node:test";

import { installWithWindowsLockRecovery } from "../../scripts/lib/update-user-experience.mjs";
import { renderCommandError } from "../../scripts/github-delivery-cli.mjs";

function eperm() {
  const error = new Error("EPERM: operation not permitted, rename target -> backup");
  error.code = "EPERM";
  return error;
}

test("headless Windows blocker fails immediately after graceful close is unavailable", async () => {
  const blocker = {
    pid: 34280,
    name: "node.exe",
    paths: ["C:\\Users\\ws\\.agents\\skills\\github-delivery\\scripts"],
  };
  let installCalls = 0;
  const sleeps = [];

  await assert.rejects(
    installWithWindowsLockRecovery({
      install() {
        installCalls += 1;
        throw eperm();
      },
      installOptions: {},
      target: "C:\\Users\\ws\\.agents\\skills\\github-delivery",
      dependencies: {
        platform: "win32",
        input: { isTTY: true },
        output: { write() {} },
        sleep: async (delay) => { sleeps.push(delay); },
        inspectWindowsInstallLocks: () => [blocker],
        confirmCloseLockingProcesses: async () => true,
        requestGracefulProcessClose: () => ({
          requested: false,
          pid: blocker.pid,
          reason: "no_main_window",
        }),
      },
    }),
    (error) => {
      assert.equal(error.message, "install_target_locked");
      assert.deepEqual(error.blockers, [blocker]);
      assert.deepEqual(error.closeResults, [{
        requested: false,
        pid: 34280,
        reason: "no_main_window",
      }]);
      return true;
    },
  );

  assert.equal(installCalls, 3);
  assert.deepEqual(sleeps, [250, 500], "do not poll for ten seconds when no close request was possible");
});

test("CLI lock error explains the blocker and safe manual recovery without force-killing it", () => {
  const chunks = [];
  const error = new Error("install_target_locked");
  error.blockers = [{
    pid: 34280,
    name: "node.exe",
    paths: ["C:\\Users\\ws\\.agents\\skills\\github-delivery\\scripts"],
  }];
  error.closeResults = [{ requested: false, pid: 34280, reason: "no_main_window" }];

  renderCommandError(error, { write: (chunk) => chunks.push(chunk) });
  const output = chunks.join("");

  assert.match(output, /node\.exe/);
  assert.match(output, /34280/);
  assert.match(output, /no main window/i);
  assert.match(output, /Get-CimInstance Win32_Process/);
  assert.match(output, /npx github-delivery update --apply/);
  assert.doesNotMatch(output, /Stop-Process[^\n]*-Force/i);
});
