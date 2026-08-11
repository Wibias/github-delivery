import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { createInterface } from "node:readline";

import { createAppServerWatchdogRouter } from "./codex-app-server-watchdog-proxy.mjs";

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_FRAME_BYTES = 16 * 1024 * 1024;

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

export async function startCodexWatchdogRemoteBridge({
  appServerInput,
  appServerOutput,
  token = null,
  router = createAppServerWatchdogRouter(),
  host = "127.0.0.1",
} = {}) {
  if (!appServerInput?.writable || !appServerOutput?.readable) {
    throw new Error("appServerInput and appServerOutput streams are required");
  }

  const clients = new Set();
  const server = createServer((request, response) => {
    response.writeHead(404).end();
  });

  server.on("upgrade", (request, socket, head) => {
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
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      broadcast(clients, line);
      return;
    }
    const routed = router.onServerMessage(message);
    if (routed.forward) broadcast(clients, JSON.stringify(routed.forward));
    for (const request of routed.internalRequests) {
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
    close: async () => {
      lines.close();
      for (const client of clients) client.destroy();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
