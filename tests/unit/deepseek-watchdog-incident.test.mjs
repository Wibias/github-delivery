import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { createAppServerWatchdogRouter } from "../../scripts/lib/codex-app-server-watchdog-proxy.mjs";
import { replayCodexWatchdogTrace } from "../../scripts/lib/codex-watchdog-replay.mjs";

const fixture = JSON.parse(
  readFileSync(
    resolve("tests/fixtures/watchdog/deepseek-parameter-loop.json"),
    "utf8",
  ),
);

function replayScenario(name) {
  const scenario = fixture.scenarios[name];
  assert.ok(scenario, `missing incident scenario ${name}`);
  const result = replayCodexWatchdogTrace(scenario.events, {
    router: createAppServerWatchdogRouter({
      internalRequestIdPrefix: `gd-deepseek-${name}`,
      watchdogOptions: scenario.watchdogOptions,
    }),
  });
  return { scenario, result };
}

function assertIncidentExpectation(name) {
  const { scenario, result } = replayScenario(name);
  assert.equal(result.interruptCount, scenario.expect.interruptCount, name);
  if (scenario.expect.firstInterruptEventMax !== undefined) {
    assert.ok(
      result.firstInterruptEvent <= scenario.expect.firstInterruptEventMax,
      `${name} interrupted at event ${result.firstInterruptEvent}`,
    );
  }
}

test("incident fixture is explicitly sanitized and preserves its provenance boundary", () => {
  assert.equal(fixture.kind, "github-delivery/watchdog-incident-fixture");
  assert.equal(fixture.source.type, "user-supplied-transcript");
  assert.equal(fixture.source.sanitized, true);
  assert.match(fixture.source.note, /channel assignments are synthetic/i);
});

test("deepseek_parameter_tool_emission_loop interrupts within six imminent-tool events", () => {
  assertIncidentExpectation("deepseek_parameter_tool_emission_loop");
});

test("deepseek_repeated_execution_narration interrupts within six imminent-tool events", () => {
  assertIncidentExpectation("deepseek_repeated_execution_narration");
});

test("deepseek_parameter_channel_hopping cannot evade the shared turn watchdog", () => {
  assertIncidentExpectation("deepseek_parameter_channel_hopping");
});

test("deepseek_tool_markup_then_real_tool resets stall state at the real tool boundary", () => {
  assertIncidentExpectation("deepseek_tool_markup_then_real_tool");
});
