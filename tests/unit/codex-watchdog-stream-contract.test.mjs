import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";

import { createAppServerWatchdogRouter } from "../../scripts/lib/codex-app-server-watchdog-proxy.mjs";
import { replayCodexWatchdogTrace } from "../../scripts/lib/codex-watchdog-replay.mjs";
import { startCodexWatchdogRemoteBridge } from "../../scripts/lib/codex-watchdog-remote-bridge.mjs";

function openWebSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener("open", () => resolve(socket), { once: true });
    socket.addEventListener("error", () => reject(new Error("WebSocket connection failed")), { once: true });
  });
}

for (const method of [
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
  "item/plan/delta",
  "turn/plan/updated",
  "turn/diff/updated",
  "thread/tokenUsage/updated",
]) {
  test(`protected stream fails closed when client opts out of ${method}`, async () => {
    const appServerInput = new PassThrough();
    const appServerOutput = new PassThrough();
    const bridge = await startCodexWatchdogRemoteBridge({
      appServerInput,
      appServerOutput,
      token: null,
    });
    const client = await openWebSocket(bridge.url);

    client.send(JSON.stringify({
      id: 1,
      method: "initialize",
      params: { capabilities: { optOutNotificationMethods: [method] } },
    }));

    const failure = await bridge.failure;
    assert.equal(failure.code, "required_notification_opted_out");
    assert.deepEqual(failure.methods, [method]);

    client.close();
    await bridge.close();
  });
}

test("watchdog trace replay deterministically reports the first interrupt", () => {
  const messages = [
    "Let me run the grep.\n",
    "Let me run the grep.\n",
    "Let me run the grep.\n",
  ].map((delta) => ({
    method: "item/reasoning/summaryTextDelta",
    params: {
      threadId: "thr-replay",
      turnId: "turn-replay",
      itemId: "reasoning-replay",
      delta,
    },
  }));

  const first = replayCodexWatchdogTrace(messages, {
    router: createAppServerWatchdogRouter({ internalRequestIdPrefix: "gd-replay" }),
  });
  const second = replayCodexWatchdogTrace(messages, {
    router: createAppServerWatchdogRouter({ internalRequestIdPrefix: "gd-replay" }),
  });

  assert.deepEqual(first, second);
  assert.equal(first.eventCount, 3);
  assert.equal(first.interruptCount, 1);
  assert.equal(first.firstInterruptEvent, 3);
  assert.equal(first.interrupts[0].method, "turn/interrupt");
  assert.deepEqual(first.interrupts[0].params, {
    threadId: "thr-replay",
    turnId: "turn-replay",
  });
});

test("watchdog replay summary does not retain generated text", () => {
  const result = replayCodexWatchdogTrace([
    {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thr-private",
        turnId: "turn-private",
        itemId: "msg-private",
        delta: "secret text that must not be copied into telemetry",
      },
    },
  ]);

  assert.doesNotMatch(JSON.stringify(result), /secret text/);
});
