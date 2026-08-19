import assert from "node:assert/strict";
import test from "node:test";

import { createAppServerWatchdogRouter } from "../../scripts/lib/codex-app-server-watchdog-proxy.mjs";

function router(options = {}) {
  return createAppServerWatchdogRouter({
    internalRequestIdPrefix: "gd-progress",
    watchdogOptions: {
      noProgressTokenSoftLimit: 10,
      noProgressTokenHardLimit: 20,
      generatedCharSoftLimit: 80,
      generatedCharHardLimit: 160,
      toolEmissionIntentThreshold: 3,
      protocolArtifactThreshold: 2,
      ...options,
    },
  });
}

function text(r, delta, method = "item/reasoning/summaryTextDelta") {
  return r.onServerMessage({
    method,
    params: {
      threadId: "thr-progress",
      turnId: "turn-progress",
      itemId: "reasoning-progress",
      delta,
    },
  });
}

function usage(r, totalTokens) {
  return r.onServerMessage({
    method: "thread/tokenUsage/updated",
    params: {
      threadId: "thr-progress",
      turnId: "turn-progress",
      tokenUsage: {
        total: { totalTokens },
        last: { totalTokens },
      },
    },
  });
}

function started(r, item) {
  return r.onServerMessage({
    method: "item/started",
    params: {
      threadId: "thr-progress",
      turnId: "turn-progress",
      item,
    },
  });
}

function completed(r, item) {
  return r.onServerMessage({
    method: "item/completed",
    params: {
      threadId: "thr-progress",
      turnId: "turn-progress",
      item,
    },
  });
}

test("novel imminent-execution narration is bounded even when every sentence differs", () => {
  const r = router({ generatedCharHardLimit: 10_000 });
  assert.equal(text(r, "Let me grep the duplicate locale key.\n").internalRequests.length, 0);
  assert.equal(text(r, "I'll execute the exact search command.\n").internalRequests.length, 0);
  const tripped = text(r, "Now run the inspection against en.ts.\n");
  assert.equal(tripped.internalRequests.length, 1);
  assert.equal(tripped.internalRequests[0].method, "turn/interrupt");
});

test("a real tool start clears the pending tool-emission stall without claiming workflow progress", () => {
  const r = router({ generatedCharHardLimit: 10_000 });
  text(r, "Let me grep the first key.\n");
  text(r, "I'll execute the search.\n");
  started(r, {
    id: "cmd-1",
    type: "commandExecution",
    command: "rg tasks.newTask.createAndStart gui/src/i18n/en.ts",
    status: "inProgress",
  });
  assert.equal(text(r, "Let me inspect the matching line.\n").internalRequests.length, 0);
  assert.equal(text(r, "I'll run the focused grep.\n").internalRequests.length, 0);
});

test("interleaved evidence tools do not buy a fresh micro-narration budget", () => {
  const r = router({
    generatedCharHardLimit: 10_000,
    toolEmissionIntentThreshold: 50,
  });

  assert.equal(
    text(r, "I will start by loading the canonical agent rules and rewrite plan.\n").internalRequests.length,
    0,
  );
  started(r, {
    id: "read-1",
    type: "commandExecution",
    command: 'Get-Content -LiteralPath "AGENTS.md" -Raw',
    status: "inProgress",
  });

  assert.equal(
    text(r, "Canonical rules are loaded. Next I'll verify the current git state.\n").internalRequests.length,
    0,
  );
  started(r, {
    id: "read-2",
    type: "commandExecution",
    command: "git status --short --branch",
    status: "inProgress",
  });

  const tripped = text(
    r,
    "GitHub Delivery owns this stack, so I'll load the stacked-PR workflow next.\n",
  );
  assert.equal(tripped.internalRequests.length, 1);
  assert.equal(tripped.internalRequests[0].method, "turn/interrupt");
});

test("real execution progress resets the micro-narration budget", () => {
  const r = router({
    generatedCharHardLimit: 10_000,
    toolEmissionIntentThreshold: 50,
  });
  assert.equal(text(r, "I'll load the first rule file.\n").internalRequests.length, 0);
  started(r, {
    id: "read-a",
    type: "commandExecution",
    command: 'Get-Content -LiteralPath "AGENTS.md" -Raw',
    status: "inProgress",
  });
  assert.equal(text(r, "Next I'll verify the branch state.\n").internalRequests.length, 0);

  completed(r, {
    id: "test-1",
    type: "commandExecution",
    command: "npm test",
    status: "completed",
    exitCode: 0,
  });

  assert.equal(text(r, "I'll load the selected workflow.\n").internalRequests.length, 0);
  started(r, {
    id: "read-b",
    type: "commandExecution",
    command: 'Get-Content -LiteralPath "references/stacked-prs.md" -Raw',
    status: "inProgress",
  });
  assert.equal(text(r, "Then I'll verify the live PR stack.\n").internalRequests.length, 0);
});

test("repeated malformed tool protocol output accelerates a tool-emission stall", () => {
  const r = router({ generatedCharHardLimit: 10_000, toolEmissionIntentThreshold: 50 });
  assert.equal(text(r, "<atool></atool>\n").internalRequests.length, 0);
  const tripped = text(r, "<invoke><atool></atool></invoke>\n");
  assert.equal(tripped.internalRequests.length, 1);
  assert.equal(tripped.internalRequests[0].method, "turn/interrupt");
});

test("cumulative Codex token usage interrupts a turn after the hard no-progress budget", () => {
  const r = router({ generatedCharHardLimit: 10_000, toolEmissionIntentThreshold: 50 });
  assert.equal(usage(r, 100).internalRequests.length, 0);
  assert.equal(text(r, "Investigating a distinct hypothesis without execution.\n").internalRequests.length, 0);
  const tripped = usage(r, 121);
  assert.equal(tripped.internalRequests.length, 1);
  assert.equal(tripped.internalRequests[0].method, "turn/interrupt");
});

test("a materially changed turn diff resets the no-progress token baseline", () => {
  const r = router({ generatedCharHardLimit: 10_000, toolEmissionIntentThreshold: 50 });
  usage(r, 100);
  usage(r, 115);
  const progress = r.onServerMessage({
    method: "turn/diff/updated",
    params: {
      threadId: "thr-progress",
      turnId: "turn-progress",
      diff: "diff --git a/a.ts b/a.ts\n+const fixed = true;\n",
    },
  });
  assert.equal(progress.internalRequests.length, 0);
  assert.equal(usage(r, 130).internalRequests.length, 0);
  const tripped = usage(r, 136);
  assert.equal(tripped.internalRequests.length, 1);
});

test("completing a plan step resets the no-progress token baseline", () => {
  const r = router({ generatedCharHardLimit: 10_000, toolEmissionIntentThreshold: 50 });
  usage(r, 200);
  usage(r, 215);
  r.onServerMessage({
    method: "turn/plan/updated",
    params: {
      threadId: "thr-progress",
      turnId: "turn-progress",
      plan: [
        { step: "inspect", status: "completed" },
        { step: "patch", status: "inProgress" },
      ],
    },
  });
  assert.equal(usage(r, 230).internalRequests.length, 0);
  assert.equal(usage(r, 236).internalRequests.length, 1);
});

test("an empty fileChange completion does not reset the hard token budget", () => {
  const r = router({ generatedCharHardLimit: 10_000, toolEmissionIntentThreshold: 50 });
  usage(r, 300);
  usage(r, 315);
  r.onServerMessage({
    method: "item/completed",
    params: {
      threadId: "thr-progress",
      turnId: "turn-progress",
      item: { id: "noop-write", type: "fileChange", changes: [], status: "completed" },
    },
  });
  assert.equal(usage(r, 321).internalRequests.length, 1);
});

test("unique generated text is bounded by characters even without token telemetry", () => {
  const r = router({
    generatedCharSoftLimit: 60,
    generatedCharHardLimit: 100,
    toolEmissionIntentThreshold: 50,
    protocolArtifactThreshold: 50,
  });
  assert.equal(text(r, "A completely novel sentence about one investigation path.\n").internalRequests.length, 0);
  const tripped = text(r, "Another unrelated sentence keeps growing without any runtime progress at all.\n");
  assert.equal(tripped.internalRequests.length, 1);
});