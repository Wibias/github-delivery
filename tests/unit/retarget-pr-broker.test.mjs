import assert from "node:assert/strict";
import test from "node:test";

import {
  executeMutationRequest,
  planMutationRequest,
} from "../../scripts/lib/github-mutation-broker.mjs";
import { authorityScopeSha256 } from "../../scripts/lib/authority-scope.mjs";

const HEAD = "abcdef1234567890";

function request(overrides = {}) {
  return {
    schemaVersion: 1,
    action: "retarget_pr",
    mutationMode: "maintainer",
    explicitInstruction: true,
    repo: "acme/widgets",
    pr: 42,
    expectedHead: HEAD,
    expectedBase: "feature/parent",
    newBase: "main",
    ...overrides,
  };
}

test("retarget_pr is brokered and binds the exact base transition", () => {
  const plan = planMutationRequest(request());
  assert.equal(plan.authorization.allowed, true);
  assert.equal(plan.expectedBase, "feature/parent");
  assert.equal(plan.newBase, "main");
  assert.deepEqual(plan.command, [
    "gh",
    "api",
    "repos/acme/widgets/pulls/42",
    "--method",
    "PATCH",
    "-f",
    "base=main",
  ]);
  assert.notEqual(
    authorityScopeSha256(request()),
    authorityScopeSha256(request({ newBase: "release" })),
  );
});

test("retarget_pr verifies head and old base before PATCH and new base afterwards", () => {
  const calls = [];
  const result = executeMutationRequest({
    request: request(),
    execute: true,
    runner(command, args) {
      calls.push([command, ...args]);
      if (args[0] === "pr" && args[1] === "view" && args.includes("headRefOid")) {
        return { status: 0, stdout: `${HEAD}\n`, stderr: "" };
      }
      if (args[0] === "pr" && args[1] === "view" && args.includes("baseRefName")) {
        const patchAlreadyRan = calls.some((call) => call.includes("PATCH"));
        return { status: 0, stdout: `${patchAlreadyRan ? "main" : "feature/parent"}\n`, stderr: "" };
      }
      if (args[0] === "api" && args.includes("PATCH")) {
        return { status: 0, stdout: "{}\n", stderr: "" };
      }
      return { status: 1, stdout: "", stderr: "unexpected command" };
    },
  });
  assert.equal(result.status, "succeeded");
  assert.equal(result.observedBase, "feature/parent");
  assert.equal(result.verification, "main");
  assert.ok(calls.some((call) => call.includes("PATCH")));
});

test("retarget_pr rejects a stale expected base before PATCH", () => {
  let patched = false;
  assert.throws(
    () =>
      executeMutationRequest({
        request: request(),
        execute: true,
        runner(command, args) {
          if (args[0] === "pr" && args[1] === "view" && args.includes("headRefOid")) {
            return { status: 0, stdout: `${HEAD}\n`, stderr: "" };
          }
          if (args[0] === "pr" && args[1] === "view" && args.includes("baseRefName")) {
            return { status: 0, stdout: "integration\n", stderr: "" };
          }
          if (args.includes("PATCH")) patched = true;
          return { status: 0, stdout: "{}\n", stderr: "" };
        },
      }),
    /expected_base_mismatch/,
  );
  assert.equal(patched, false);
});

test("retarget_pr retry detects an already-applied target without another PATCH", () => {
  let patched = false;
  const result = executeMutationRequest({
    request: request(),
    execute: true,
    runner(command, args) {
      if (args[0] === "pr" && args[1] === "view" && args.includes("headRefOid")) {
        return { status: 0, stdout: `${HEAD}\n`, stderr: "" };
      }
      if (args[0] === "pr" && args[1] === "view" && args.includes("baseRefName")) {
        return { status: 0, stdout: "main\n", stderr: "" };
      }
      if (args.includes("PATCH")) patched = true;
      return { status: 0, stdout: "{}\n", stderr: "" };
    },
  });
  assert.equal(result.status, "already_applied");
  assert.equal(result.verification, "main");
  assert.equal(patched, false);
});
