import assert from "node:assert/strict";
import test from "node:test";

import {
  executeMutationWithAuthority,
  planMutationWithAuthority,
} from "../../scripts/lib/mutation-execution-context.mjs";

const OFF = { schemaVersion: 1, authorityMode: "off" };
const OLD = "a".repeat(40);
const LOCAL = "e".repeat(40);
const NEW = "b".repeat(40);

test("authority off may preserve compatibility planning but never produces verified user authority", () => {
  const plan = planMutationWithAuthority({
    schemaVersion: 1,
    action: "create_issue",
    mutationMode: "maintainer",
    explicitInstruction: false,
    repo: "acme/widgets",
    idempotencyKey: "audit-003-create",
    title: "Boundary regression",
    body: "body",
  }, {
    config: OFF,
    trustedWorkflowIntent: true,
  });
  assert.equal(plan.authorization.allowed, true);
  assert.equal(plan.authority.verified, false);
  assert.equal(plan.authority.provenance, "authority_disabled_by_user");
});

test("authority off cannot execute a mutation after caller mode or workflow-context promotion", () => {
  assert.throws(
    () => executeMutationWithAuthority({
      request: {
        schemaVersion: 1,
        action: "push_code",
        mutationMode: "maintainer",
        repo: "acme/widgets",
        remote: "origin",
        branch: "feature/audit-003",
        expectedRemoteTip: OLD,
        originalLocalTip: LOCAL,
        newTip: NEW,
        forceWithLease: false,
      },
      execute: true,
      config: OFF,
      trustedWorkflowIntent: true,
      runner() {
        throw new Error("runner_must_not_be_called");
      },
    }),
    /mutation_execution_denied:authority_mode_off/,
  );
});
