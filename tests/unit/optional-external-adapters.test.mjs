import assert from "node:assert/strict";
import test from "node:test";

import { planOptionalAdapter } from "../../scripts/lib/optional-external-adapters.mjs";

function inventory(statuses = {}) {
  return {
    kind: "github-delivery/capability-inventory",
    capabilities: Object.fromEntries(
      Object.entries(statuses).map(([id, status]) => [id, { id, status }]),
    ),
  };
}

test("Promptfoo coding-agent red team requires an explicit user request and authorized target", () => {
  const absentRequest = planOptionalAdapter({
    adapter: "promptfoo",
    inventory: inventory({ promptfoo: "available" }),
    explicitUserRequest: false,
    authorizedTarget: true,
    targetKind: "coding-agent",
  });
  assert.equal(absentRequest.status, "blocked");
  assert.ok(absentRequest.blockers.includes("explicit-user-red-team-request-required"));

  const unauthorized = planOptionalAdapter({
    adapter: "promptfoo",
    inventory: inventory({ promptfoo: "available" }),
    explicitUserRequest: true,
    authorizedTarget: false,
    targetKind: "coding-agent",
  });
  assert.equal(unauthorized.status, "blocked");
  assert.ok(unauthorized.blockers.includes("authorized-target-required"));
});

test("available Promptfoo adapter plans the current redteam run command without install fallback", () => {
  const result = planOptionalAdapter({
    adapter: "promptfoo",
    inventory: inventory({ promptfoo: "available" }),
    explicitUserRequest: true,
    authorizedTarget: true,
    targetKind: "coding-agent",
    requestedBlocking: false,
  });

  assert.equal(result.status, "ready");
  assert.deepEqual(result.invocation, { command: "promptfoo", args: ["redteam", "run"] });
  assert.equal(result.blocking, false);
  assert.equal(result.installAllowed, false);
  assert.ok(result.evidenceRequirements.includes("trace-or-command-tool-evidence"));
  assert.ok(result.evidenceRequirements.includes("fresh-disposable-checkout"));
});

test("unavailable optional red-team tool remains unavailable without auto-install", () => {
  const result = planOptionalAdapter({
    adapter: "promptfoo",
    inventory: inventory({ promptfoo: "unavailable" }),
    explicitUserRequest: true,
    authorizedTarget: true,
    targetKind: "coding-agent",
  });

  assert.equal(result.status, "unavailable");
  assert.equal(result.invocation, null);
  assert.equal(result.installAllowed, false);
  assert.equal(result.installAttempted, false);
});

test("PyRIT requires an explicit scenario and is never the default coding-agent adapter", () => {
  const missingScenario = planOptionalAdapter({
    adapter: "pyrit",
    inventory: inventory({ pyrit: "available" }),
    explicitUserRequest: true,
    authorizedTarget: true,
    targetKind: "ai-application",
  });
  assert.equal(missingScenario.status, "blocked");
  assert.ok(missingScenario.blockers.includes("pyrit-scenario-required"));

  const ready = planOptionalAdapter({
    adapter: "pyrit",
    inventory: inventory({ pyrit: "available" }),
    explicitUserRequest: true,
    authorizedTarget: true,
    targetKind: "ai-application",
    scenarioId: "airt.scam",
    pyritTarget: "openai_chat",
  });
  assert.equal(ready.status, "ready");
  assert.deepEqual(ready.invocation, { command: "pyrit_scan", args: ["airt.scam", "--target", "openai_chat"] });
  assert.equal(ready.preferredForCodingAgents, false);
});

test("Human Review is limited to visual content surfaces and cannot satisfy ship evidence", () => {
  const ready = planOptionalAdapter({
    adapter: "human-review",
    inventory: inventory({ "human-review": "available" }),
    explicitUserRequest: true,
    target: "docs/plan.md",
    targetKind: "markdown",
  });
  assert.equal(ready.status, "ready");
  assert.deepEqual(ready.invocation, { command: "human-review", args: ["docs/plan.md"] });
  assert.equal(ready.evidenceRole, "human-content-feedback");
  assert.equal(ready.satisfiesShipGate, false);
  assert.equal(ready.satisfiesSecurityReview, false);

  const code = planOptionalAdapter({
    adapter: "human-review",
    inventory: inventory({ "human-review": "available" }),
    explicitUserRequest: true,
    target: "src/auth.mjs",
    targetKind: "code",
  });
  assert.equal(code.status, "blocked");
  assert.ok(code.blockers.includes("human-review-surface-not-supported"));
});

test("red-team output is candidate evidence and never native ship authority", () => {
  const result = planOptionalAdapter({
    adapter: "promptfoo",
    inventory: inventory({ promptfoo: "available" }),
    explicitUserRequest: true,
    authorizedTarget: true,
    targetKind: "coding-agent",
    requestedBlocking: true,
  });
  assert.equal(result.evidenceRole, "external-candidate-producer");
  assert.equal(result.satisfiesShipGate, false);
  assert.equal(result.satisfiesNativeReview, false);
  assert.equal(result.blocking, true);
});
