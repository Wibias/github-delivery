import assert from "node:assert/strict";
import test from "node:test";

import { buildCreatePrPublicationPlan } from "../../scripts/lib/create-pr-publication-plan.mjs";
import {
  lifecycleCommandFor,
  preflightLifecycleMutation,
} from "../../scripts/lib/lifecycle-mutations.mjs";

const OLD = "a".repeat(40);
const NEW = "b".repeat(40);
const REMOTE = "origin";
const BRANCH = "fix/ordinary-fast-forward";
const REPO = "Wibias/github-delivery";

function pushRequest(overrides = {}) {
  return {
    schemaVersion: 1,
    action: "push_code",
    mutationMode: "maintainer",
    explicitInstruction: true,
    repo: REPO,
    remote: REMOTE,
    branch: BRANCH,
    expectedRemoteTip: OLD,
    originalLocalTip: OLD,
    newTip: NEW,
    forceWithLease: false,
    ...overrides,
  };
}

function runner({ remoteTip = OLD, ancestor = true } = {}) {
  return (command, args) => {
    if (command === "git" && args[0] === "check-ref-format") {
      return { status: 0, stdout: "", stderr: "" };
    }
    if (command === "git" && args[0] === "remote" && args[1] === "get-url") {
      return { status: 0, stdout: "git@github.com:Wibias/github-delivery.git\n", stderr: "" };
    }
    if (command === "gh" && args[0] === "repo" && args[1] === "view") {
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
      return {
        status: 0,
        stdout: remoteTip === "absent" ? "" : `${remoteTip}\trefs/heads/${BRANCH}\n`,
        stderr: "",
      };
    }
    if (command === "git" && args[0] === "merge-base") {
      return { status: ancestor ? 0 : 1, stdout: "", stderr: "" };
    }
    throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
  };
}

test("ordinary fast-forward command carries no force or lease token", () => {
  const command = lifecycleCommandFor(pushRequest());
  assert.deepEqual(command, ["git", "push", REMOTE, `${NEW}:refs/heads/${BRANCH}`]);
  assert.ok(command.every((token) => !/force|lease|^\+/i.test(token)));
});

test("the default force-with-lease command stays byte-identical", () => {
  const command = lifecycleCommandFor(pushRequest({ forceWithLease: true }));
  assert.deepEqual(command, [
    "git",
    "push",
    `--force-with-lease=refs/heads/${BRANCH}:${OLD}`,
    REMOTE,
    `${NEW}:refs/heads/${BRANCH}`,
  ]);
});

test("a new remote branch keeps the absent-tip lease even when fast-forward was requested", () => {
  const command = lifecycleCommandFor(
    pushRequest({ expectedRemoteTip: "absent", forceWithLease: false }),
  );
  assert.deepEqual(command, [
    "git",
    "push",
    `--force-with-lease=refs/heads/${BRANCH}:`,
    REMOTE,
    `${NEW}:refs/heads/${BRANCH}`,
  ]);
});

test("the planner's fast-forward plan yields the force-free command end to end", () => {
  const plan = buildCreatePrPublicationPlan({
    repo: REPO,
    remote: REMOTE,
    branch: BRANCH,
    base: "main",
    expectedRemoteTip: OLD,
    originalLocalTip: OLD,
    newTip: NEW,
    title: "Fix",
    body: "Body\n",
    idempotencyKey: "ordinary-fast-forward",
    checkpoint: ".github-delivery/workflow.json",
    pushMode: "fast-forward",
  });
  assert.equal(plan.requests[0].forceWithLease, false);
  assert.deepEqual(lifecycleCommandFor(plan.requests[0]), [
    "git",
    "push",
    REMOTE,
    `${NEW}:refs/heads/${BRANCH}`,
  ]);
});

test("preflight accepts a genuine fast-forward under the force-free mode", () => {
  assert.deepEqual(preflightLifecycleMutation({ request: pushRequest(), runner: runner() }), {
    remote: REMOTE,
    branch: BRANCH,
    expectedRemoteTip: OLD,
    originalLocalTip: OLD,
    newTip: NEW,
  });
});

test("preflight refuses a non-fast-forward under the force-free mode", () => {
  assert.throws(
    () =>
      preflightLifecycleMutation({
        request: pushRequest(),
        runner: runner({ ancestor: false }),
      }),
    /mutation_preflight_failed:1/,
  );
});

test("preflight refuses a remote tip mismatch under the force-free mode", () => {
  assert.throws(
    () =>
      preflightLifecycleMutation({
        request: pushRequest(),
        runner: runner({ remoteTip: "c".repeat(40) }),
      }),
    /expected_remote_tip_mismatch/,
  );
});
