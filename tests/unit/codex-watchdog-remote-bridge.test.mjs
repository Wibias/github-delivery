import assert from "node:assert/strict";
import { connect } from "node:net";
import { PassThrough } from "node:stream";
import test from "node:test";

import { startCodexWatchdogRemoteBridge } from "../../scripts/lib/codex-watchdog-remote-bridge.mjs";

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function captureRequests(stream) {
  let buffer = "";
  const requests = [];
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    while (buffer.includes("\n")) {
      const index = buffer.indexOf("\n");
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (!line.trim()) continue;
      try {
        requests.push(JSON.parse(line));
      } catch {
        // Ignore non-JSON fixture traffic.
      }
    }
  });
  return requests;
}

async function waitFor(predicate, { timeoutMs = 500 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await delay(5);
  }
  throw new Error("timed out waiting for test condition");
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

test("protected bridge fails closed when client opts out of required watchdog notifications", async () => {
  const appServerInput = new PassThrough();
  const appServerOutput = new PassThrough();
  const bridge = await startCodexWatchdogRemoteBridge({ appServerInput, appServerOutput, token: null });
  const client = await openWebSocket(bridge.url);

  client.send(JSON.stringify({
    id: 1,
    method: "initialize",
    params: {
      capabilities: {
        optOutNotificationMethods: ["item/agentMessage/delta"],
      },
    },
  }));

  const failure = await bridge.failure;
  assert.equal(failure.code, "required_notification_opted_out");
  assert.match(failure.message, /item\/agentMessage\/delta/);

  client.close();
  await bridge.close();
});

test("protected bridge fails closed when a non-empty completed agent message had no deltas", async () => {
  const appServerInput = new PassThrough();
  const appServerOutput = new PassThrough();
  const bridge = await startCodexWatchdogRemoteBridge({ appServerInput, appServerOutput, token: null });
  const client = await openWebSocket(bridge.url);

  appServerOutput.write(`${JSON.stringify({
    method: "item/completed",
    params: {
      threadId: "thr-health",
      turnId: "turn-health",
      item: { id: "msg-health", type: "agentMessage", text: "I produced text without deltas." },
    },
  })}\n`);

  const failure = await bridge.failure;
  assert.equal(failure.code, "agent_message_delta_missing");

  client.close();
  await bridge.close();
});

test("protected bridge fails closed when turn interrupt returns an error", async () => {
  const appServerInput = new PassThrough();
  const appServerOutput = new PassThrough();
  const requests = captureRequests(appServerInput);
  const bridge = await startCodexWatchdogRemoteBridge({ appServerInput, appServerOutput, token: null });
  const client = await openWebSocket(bridge.url);

  for (let index = 0; index < 3; index += 1) {
    appServerOutput.write(`${JSON.stringify({
      method: "item/agentMessage/delta",
      params: {
        threadId: "thr-error",
        turnId: "turn-error",
        itemId: "msg-error",
        delta: "Let me read request-log.test.ts.\n",
      },
    })}\n`);
  }

  const interrupt = await waitFor(() => requests.find((request) => request.method === "turn/interrupt"));
  appServerOutput.write(`${JSON.stringify({
    id: interrupt.id,
    error: { code: -32000, message: "cannot interrupt" },
  })}\n`);

  const failure = await bridge.failure;
  assert.equal(failure.code, "interrupt_rejected");
  assert.match(failure.message, /cannot interrupt/);

  client.close();
  await bridge.close();
});

test("protected bridge fails closed when turn interrupt is not acknowledged", async () => {
  const appServerInput = new PassThrough();
  const appServerOutput = new PassThrough();
  const requests = captureRequests(appServerInput);
  const bridge = await startCodexWatchdogRemoteBridge({
    appServerInput,
    appServerOutput,
    token: null,
    interruptAckTimeoutMs: 25,
  });
  const client = await openWebSocket(bridge.url);

  for (let index = 0; index < 3; index += 1) {
    appServerOutput.write(`${JSON.stringify({
      method: "item/agentMessage/delta",
      params: {
        threadId: "thr-timeout",
        turnId: "turn-timeout",
        itemId: "msg-timeout",
        delta: "Let me read request-log.test.ts.\n",
      },
    })}\n`);
  }

  await waitFor(() => requests.find((request) => request.method === "turn/interrupt"));
  const failure = await bridge.failure;
  assert.equal(failure.code, "interrupt_ack_timeout");

  client.close();
  await bridge.close();
});
