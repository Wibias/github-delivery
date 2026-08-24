import assert from "node:assert/strict";
import test from "node:test";

import { executeLifecycleMutationRequest } from "../../scripts/lib/github-lifecycle-mutation-broker.mjs";
import { createMemoryRewriteBaselineStore } from "../../scripts/lib/rewrite-baseline-store.mjs";

const OLD = "a".repeat(40);
const NEW = "b".repeat(40);

function seededStore() {
  const store = createMemoryRewriteBaselineStore();
  store.create(
    { repo: "Wibias/github-delivery", remote: "origin", branch: "feature/safe" },
    "e".repeat(40),
  );
  return store;
}

function pushRequest() {
  return {
    schemaVersion: 1,
    action: "push_code",
    mutationMode: "maintainer",
    repo: "Wibias/github-delivery",
    remote: "origin",
    branch: "feature/safe",
    expectedRemoteTip: OLD,
    originalLocalTip: "e".repeat(40),
    newTip: NEW,
    forceWithLease: true,
  };
}

function pushRunner({ pushResult, remoteAfterPush }) {
  let lsRemoteCount = 0;
  return (command, args) => {
    if (command === "git" && args[0] === "check-ref-format") {
      return { status: 0, stdout: "", stderr: "" };
    }
    if (command === "git" && args[0] === "remote") {
      return { status: 0, stdout: "git@github.com:Wibias/github-delivery.git\n", stderr: "" };
    }
    if (command === "gh" && args[0] === "repo") {
      return {
        status: 0,
        stdout: JSON.stringify({
          url: "https://github.com/Wibias/github-delivery",
          sshUrl: "git@github.com:Wibias/github-delivery.git",
        }),
        stderr: "",
      };
    }
    if (command === "git" && args[0] === "ls-remote") {
      lsRemoteCount += 1;
      const tip = lsRemoteCount === 1 ? OLD : remoteAfterPush;
      return { status: 0, stdout: `${tip}\trefs/heads/feature/safe\n`, stderr: "" };
    }
    if (command === "git" && args[0] === "merge-base") {
      return { status: 1, stdout: "", stderr: "" };
    }
    if (command === "git" && args[0] === "rev-parse") {
      return { status: 0, stdout: `${"e".repeat(40)}\n`, stderr: "" };
    }
    if (command === "git" && args[0] === "push") {
      return pushResult;
    }
    throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
  };
}

test("a timed-out push that already landed on newTip is reconciled", () => {
  const store = seededStore();
  const result = executeLifecycleMutationRequest({
    request: pushRequest(),
    execute: true,
    requireTrustedAuthority: false,
    runner: pushRunner({
      pushResult: { status: null, signal: "SIGKILL", stdout: "", stderr: "subprocess_timeout:git:30000ms" },
      remoteAfterPush: NEW,
    }),
    baselineStore: store,
  });
  assert.equal(result.status, "reconciled_after_error");
  assert.equal(result.executed, true);
  assert.equal(result.verification, NEW);
  assert.equal(
    store.read({ repo: "Wibias/github-delivery", remote: "origin", branch: "feature/safe" }),
    null,
  );
});

test("a timed-out push whose remote is still the old tip stays a failure", () => {
  assert.throws(
    () =>
      executeLifecycleMutationRequest({
        request: pushRequest(),
        execute: true,
        requireTrustedAuthority: false,
        runner: pushRunner({
          pushResult: { status: null, signal: "SIGKILL", stdout: "", stderr: "subprocess_timeout:git:30000ms" },
          remoteAfterPush: OLD,
        }),
        baselineStore: seededStore(),
      }),
    /subprocess_timeout|mutation_command_failed/,
  );
});

test("a timed-out push whose remote moved to a third tip is unknown", () => {
  assert.throws(
    () =>
      executeLifecycleMutationRequest({
        request: pushRequest(),
        execute: true,
        requireTrustedAuthority: false,
        runner: pushRunner({
          pushResult: { status: null, signal: "SIGKILL", stdout: "", stderr: "subprocess_timeout:git:30000ms" },
          remoteAfterPush: "c".repeat(40),
        }),
        baselineStore: seededStore(),
      }),
    /push_outcome_unknown/,
  );
});
