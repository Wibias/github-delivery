import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { createInterface } from "node:readline";

import { createAppServerWatchdogRouter } from "./codex-app-server-watchdog-proxy.mjs";

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const DEFAULT_INTERRUPT_ACK_TIMEOUT_MS = 2_000;
const REQUIRED_NOTIFICATIONS = new Set([
  "item/agentMessage/delta",
  "item/started",
  "item/completed",
  "turn/started",
  "turn/completed",
]);

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

function encodeFrame(payload, opcode = 0x1) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), "utf8");
  if (data.length > MAX_FRAME_BYTES) throw new Error("WebSocket frame exceeds watchdog bridge limit");
  let header;
  if (data.length < 126) {
    header = Buffer.from([0x80 | opcode, data.length]);
  } else if (data.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(data.length), 2);
  }
  return Buffer.concat([header, data]);
}

function safeWriteFrame(socket, payload, opcode = 0x1) {
  if (socket.destroyed || !socket.writable) return false;
  try {
    socket.write(encodeFrame(payload, opcode));
    return true;
  } catch {
    socket.destroy();
    return false;
  }
}

function broadcast(clients, payload) {
  for (const client of clients) safeWriteFrame(client, payload);
}

function createFrameParser(onText, onClose, sendControl) {
  let buffer = Buffer.alloc(0);
  let fragmentedOpcode = null;
  let fragments = [];

  function deliver(opcode, payload, fin) {
    if (opcode === 0x8) {
      onClose();
      return;
    }
    if (opcode === 0x9) {
      sendControl(0xA, payload);
      return;
    }
    if (opcode === 0xA) return;

    if (opcode === 0x0) {
      if (fragmentedOpcode === null) throw new Error("unexpected continuation frame");
      fragments.push(payload);
      if (fin) {
        const complete = Buffer.concat(fragments);
        const originalOpcode = fragmentedOpcode;
        fragmentedOpcode = null;
        fragments = [];
        if (originalOpcode === 0x1) onText(complete.toString("utf8"));
      }
      return;
    }

    if (opcode !== 0x1) throw new Error(`unsupported WebSocket opcode ${opcode}`);
    if (fin) {
      onText(payload.toString("utf8"));
    } else {
      fragmentedOpcode = opcode;
      fragments = [payload];
    }
  }

  return {
    push(chunk) {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 2) {
        const first = buffer[0];
        const second = buffer[1];
        const fin = Boolean(first & 0x80);
        const opcode = first & 0x0f;
        const masked = Boolean(second & 0x80);
        let length = second & 0x7f;
        let offset = 2;

        if (length === 126) {
          if (buffer.length < 4) return;
          length = buffer.readUInt16BE(2);
          offset = 4;
        } else if (length === 127) {
          if (buffer.length < 10) return;
          const large = buffer.readBigUInt64BE(2);
          if (large > BigInt(MAX_FRAME_BYTES)) throw new Error("WebSocket frame exceeds watchdog bridge limit");
          length = Number(large);
          offset = 10;
        }
        if (length > MAX_FRAME_BYTES) throw new Error("WebSocket frame exceeds watchdog bridge limit");
        if (!masked) throw new Error("client WebSocket frames must be masked");
        if (buffer.length < offset + 4 + length) return;

        const mask = buffer.subarray(offset, offset + 4);
        offset += 4;
        const payload = Buffer.from(buffer.subarray(offset, offset + length));
        for (let index = 0; index < payload.length; index += 1) {
          payload[index] ^= mask[index % 4];
        }
        buffer = buffer.subarray(offset + length);
        deliver(opcode, payload, fin);
      }
    },
  };
}

function rejectUpgrade(socket, status, message) {
  socket.end(
    `HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`,
  );
}

function headerContainsToken(value, token) {
  return String(value || "")
    .split(",")
    .some((part) => part.trim().toLowerCase() === token);
}

function optedOutRequiredNotifications(message) {
  if (message?.method !== "initialize") return [];
  const values = message?.params?.capabilities?.optOutNotificationMethods;
  if (!Array.isArray(values)) return [];
  return values.filter((method) => REQUIRED_NOTIFICATIONS.has(String(method)));
}

function agentMessageText(item) {
  if (!item || item.type !== "agentMessage") return "";
  if (typeof item.text === "string") return item.text;
  if (typeof item.content === "string") return item.content;
  if (Array.isArray(item.content)) {
    return item.content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        if (typeof part?.content === "string") return part.content;
        return "";
      })
      .join("");
  }
  return "";
}

function messageItemKey(message) {
  const params = message?.params || {};
  const itemId = params.itemId || params.item?.id;
  if (!itemId) return null;
  return `${params.threadId || "unknown-thread"}\0${params.turnId || "unknown-turn"}\0${itemId}`;
}

export async function startCodexWatchdogRemoteBridge({
  appServerInput,
  appServerOutput,
  token = null,
  router = createAppServerWatchdogRouter(),
  host = "127.0.0.1",
  interruptAckTimeoutMs = DEFAULT_INTERRUPT_ACK_TIMEOUT_MS,
  onFailure = null,
} = {}) {
  if (!appServerInput?.writable || !appServerOutput?.readable) {
    throw new Error("appServerInput and appServerOutput streams are required");
  }
  if (!Number.isInteger(interruptAckTimeoutMs) || interruptAckTimeoutMs < 1) {
    throw new Error("interruptAckTimeoutMs must be a positive integer");
  }

  const clients = new Set();
  const pendingInterrupts = new Map();
  const agentMessageDeltas = new Set();
  let failureState = null;
  let resolveFailure;
  const failure = new Promise((resolve) => {
    resolveFailure = resolve;
  });

  function clearPendingInterrupts() {
    for (const pending of pendingInterrupts.values()) clearTimeout(pending.timer);
    pendingInterrupts.clear();
  }

  function failClosed(code, message, details = {}) {
    if (failureState) return failureState;
    failureState = { code, message, ...details };
    clearPendingInterrupts();
    for (const client of clients) client.destroy();
    resolveFailure(failureState);
    if (typeof onFailure === "function") {
      try {
        onFailure(failureState);
      } catch {
        // The enforcement failure is already recorded; callback errors must not mask it.
      }
    }
    return failureState;
  }

  function inspectClientMessage(text) {
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return true;
    }
    const optedOut = optedOutRequiredNotifications(message);
    if (optedOut.length) {
      failClosed(
        "required_notification_opted_out",
        `Protected watchdog stream requires notification methods that the client disabled: ${optedOut.join(", ")}`,
        { methods: optedOut },
      );
      return false;
    }
    return true;
  }

  function inspectServerMessage(message) {
    if (message?.method === "item/agentMessage/delta") {
      const key = messageItemKey(message);
      if (key) agentMessageDeltas.add(key);
    }

    if (message?.method === "item/completed" && message?.params?.item?.type === "agentMessage") {
      const text = agentMessageText(message.params.item);
      const key = messageItemKey(message);
      if (text.trim() && (!key || !agentMessageDeltas.has(key))) {
        failClosed(
          "agent_message_delta_missing",
          "Protected watchdog stream observed a non-empty completed agent message without the required streaming deltas.",
          { turnId: message?.params?.turnId || null, itemId: message?.params?.item?.id || null },
        );
        return;
      }
      if (key) agentMessageDeltas.delete(key);
    }

    if (message?.method === "turn/completed") {
      const turnId = message?.params?.turn?.id;
      if (turnId) {
        for (const key of agentMessageDeltas) {
          if (key.includes(`\0${turnId}\0`)) agentMessageDeltas.delete(key);
        }
      }
    }
  }

  function trackInterrupt(request) {
    if (request?.method !== "turn/interrupt" || request.id === undefined) return;
    const timer = setTimeout(() => {
      if (!pendingInterrupts.has(request.id)) return;
      pendingInterrupts.delete(request.id);
      failClosed(
        "interrupt_ack_timeout",
        `Protected watchdog turn interrupt ${String(request.id)} was not acknowledged within ${interruptAckTimeoutMs}ms.`,
        { requestId: request.id, turnId: request?.params?.turnId || null },
      );
    }, interruptAckTimeoutMs);
    timer.unref?.();
    pendingInterrupts.set(request.id, { timer, request });
  }

  function inspectInterruptResponse(message) {
    if (!message || !Object.hasOwn(message, "id") || !pendingInterrupts.has(message.id)) return;
    const pending = pendingInterrupts.get(message.id);
    clearTimeout(pending.timer);
    pendingInterrupts.delete(message.id);
    if (message.error) {
      const remoteMessage = String(message.error?.message || "App Server rejected turn interrupt");
      failClosed(
        "interrupt_rejected",
        `Protected watchdog turn interrupt failed: ${remoteMessage}`,
        { requestId: message.id, turnId: pending.request?.params?.turnId || null },
      );
    }
  }

  const server = createServer((request, response) => {
    response.writeHead(404).end();
  });

  server.on("upgrade", (request, socket, head) => {
    if (failureState) {
      rejectUpgrade(socket, "503 Service Unavailable", "watchdog bridge enforcement contract failed");
      return;
    }
    if (clients.size > 0) {
      rejectUpgrade(socket, "409 Conflict", "watchdog bridge already has a client");
      return;
    }
    if (token !== null) {
      const expected = `Bearer ${token}`;
      if (!safeEqual(request.headers.authorization, expected)) {
        rejectUpgrade(socket, "401 Unauthorized", "missing or invalid watchdog bridge token");
        return;
      }
    }
    const key = request.headers["sec-websocket-key"];
    const version = String(request.headers["sec-websocket-version"] || "");
    const upgrade = String(request.headers.upgrade || "").toLowerCase();
    const connectionUpgrade = headerContainsToken(request.headers.connection, "upgrade");
    if (!key || version !== "13" || upgrade !== "websocket" || !connectionUpgrade) {
      rejectUpgrade(socket, "400 Bad Request", "invalid WebSocket upgrade");
      return;
    }
    const accept = createHash("sha1").update(`${key}${WEBSOCKET_GUID}`).digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    clients.add(socket);

    const parser = createFrameParser(
      (text) => {
        if (failureState) return;
        if (!inspectClientMessage(text)) return;
        if (appServerInput.writable) appServerInput.write(`${text}\n`);
      },
      () => socket.end(),
      (opcode, payload) => safeWriteFrame(socket, payload, opcode),
    );
    socket.on("data", (chunk) => {
      try {
        parser.push(chunk);
      } catch {
        socket.destroy();
      }
    });
    socket.on("close", () => clients.delete(socket));
    socket.on("error", () => clients.delete(socket));
    if (head?.length) {
      try {
        parser.push(head);
      } catch {
        socket.destroy();
      }
    }
  });

  const lines = createInterface({ input: appServerOutput, crlfDelay: Infinity });
  lines.on("line", (line) => {
    if (failureState) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      broadcast(clients, line);
      return;
    }

    inspectInterruptResponse(message);
    if (failureState) return;
    inspectServerMessage(message);
    if (failureState) return;

    let routed;
    try {
      routed = router.onServerMessage(message);
    } catch (error) {
      failClosed(
        "watchdog_router_failure",
        `Protected watchdog router failed: ${error?.message || error}`,
      );
      return;
    }
    if (routed.forward) broadcast(clients, JSON.stringify(routed.forward));
    for (const request of routed.internalRequests) {
      trackInterrupt(request);
      if (appServerInput.writable) appServerInput.write(`${JSON.stringify(request)}\n`);
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("watchdog bridge did not bind TCP");

  return {
    url: `ws://${host}:${address.port}`,
    failure,
    failureState: () => failureState,
    close: async () => {
      clearPendingInterrupts();
      lines.close();
      for (const client of clients) client.destroy();
      if (!server.listening) return;
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
