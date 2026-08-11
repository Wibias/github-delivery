import assert from "node:assert/strict";
import { connect } from "node:net";
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

function rawUpgrade(url) {
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const socket = connect({ host: parsed.hostname, port: Number(parsed.port) });
    let response = "";
    socket.setEncoding("utf8");
    socket.once("error", reject);
    socket.on("data", (chunk) => {
      response += chunk;
    });
    socket.once("end", () => resolve(response));
    socket.once("connect", () => {
      socket.write(
        "GET / HTTP/1.1\r\n" +
          `Host: ${parsed.host}\r\n` +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
          "Sec-WebSocket-Version: 13\r\n\r\n",
      );
    });
  });
}

test("protected bridge rejects a client that lacks its bearer token", async () => {
  const appServerInput = new PassThrough();
  const appServerOutput = new PassThrough();
  const bridge = await startCodexWatchdogRemoteBridge({
    appServerInput,
    appServerOutput,
    token: "secret-token",
  });

  const response = await rawUpgrade(bridge.url);
  assert.match(response, /^HTTP\/1\.1 401 Unauthorized/m);

  await bridge.close();
});

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
