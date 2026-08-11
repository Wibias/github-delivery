import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";

import { startCodexWatchdogRemoteBridge } from "../../scripts/lib/codex-watchdog-remote-bridge.mjs";

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function openWebSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener("open", () => resolve(socket), { once: true });
    socket.addEventListener("error", () => reject(new Error("WebSocket connection failed")), { once: true });
  });
}

test("installed streaming boundary interrupts the observed Let me check type loop before 500 characters", async () => {
  const appServerInput = new PassThrough();
  const appServerOutput = new PassThrough();
  let requests = "";
  appServerInput.on("data", (chunk) => {
    requests += chunk.toString("utf8");
  });

  const bridge = await startCodexWatchdogRemoteBridge({
    appServerInput,
    appServerOutput,
    token: null,
  });
  const client = await openWebSocket(bridge.url);

  const phrases = [
    "Let me check the type.\n",
    "Let me check the NOUS_DEF type.\n",
    "Let me check the live test type.\n",
    "Let me check the type.\n",
    "Let me check the OAuthProviderDef type.\n",
    "Let me check the type.\n",
    "Let me check the current NOUS_DEF type.\n",
    "Let me check the type.\n",
  ];

  let emitted = 0;
  for (const delta of phrases) {
    emitted += delta.length;
    appServerOutput.write(
      `${JSON.stringify({
        method: "item/agentMessage/delta",
        params: {
          threadId: "thr_live",
          turnId: "turn_live",
          itemId: "item_live",
          delta,
        },
      })}\n`,
    );
    await nextTurn();
    if (requests.includes('"method":"turn/interrupt"')) break;
  }

  assert.match(requests, /"method":"turn\/interrupt"/);
  assert.ok(emitted < 500, `protected boundary allowed ${emitted} characters before interruption`);
  assert.equal((requests.match(/"method":"turn\/interrupt"/g) || []).length, 1);

  appServerOutput.write(
    `${JSON.stringify({
      method: "item/agentMessage/delta",
      params: {
        threadId: "thr_live",
        turnId: "turn_live",
        itemId: "item_live",
        delta: "Let me check the type.\n",
      },
    })}\n`,
  );
  await nextTurn();
  assert.equal((requests.match(/"method":"turn\/interrupt"/g) || []).length, 1);

  client.close();
  await bridge.close();
});
