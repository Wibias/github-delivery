import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { planMutationRequest } from "../../scripts/lib/github-mutation-broker.mjs";
import { readMergeState } from "../../scripts/lib/merge-outcome.mjs";

function resolveRequest(overrides = {}) {
  return {
    schemaVersion: 1,
    action: "resolve_thread",
    mutationMode: "maintainer",
    explicitInstruction: true,
    repo: "acme/widgets",
    pr: 32,
    expectedHead: "abcdef1234567890",
    threadId: "PRRT_target",
    ...overrides,
  };
}

test("resolve_thread plans refuse at-file thread ids", () => {
  assert.throws(
    () => planMutationRequest(resolveRequest({ threadId: "@secret.txt" })),
    /thread_id_at_file/,
  );
});

test("resolve_thread plans keep ordinary thread ids", () => {
  const plan = planMutationRequest(resolveRequest());
  assert.ok(plan.command.includes("id=PRRT_target"));
  assert.ok(!plan.command.some((part) => String(part).includes("@secret")));
});

test("readMergeState refuses at-file repository names before spawn", () => {
  let spawned = false;
  assert.throws(
    () => readMergeState({
      request: {
        action: "merge_pr",
        repo: "acme/@secret.txt",
        pr: 32,
        expectedHead: "abcdef1234567890",
      },
      runner() {
        spawned = true;
        return { status: 0, stdout: "{}", stderr: "" };
      },
    }),
    /name_at_file/,
  );
  assert.equal(spawned, false);
});

test("ship-gate snapshot guards GraphQL after cursors", () => {
  const source = readFileSync(new URL("../../scripts/ship-gate-snapshot.mjs", import.meta.url), "utf8");
  assert.match(source, /graphqlCliField\(\s*after/);
});
