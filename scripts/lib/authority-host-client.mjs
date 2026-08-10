import {
  closeSync,
  constants as fsConstants,
  openSync,
  readSync,
  writeSync,
} from "node:fs";
import { randomUUID } from "node:crypto";

export const AUTHORITY_PROTOCOL = "github-delivery-authority/1";
export const DEFAULT_AUTHORITY_PIPE = "github-delivery-authority-v1";
export const MAX_AUTHORITY_FRAME_BYTES = 256 * 1024;
export const AUTHORITY_HOST_BUSY_ERROR = "authority_host_error:authority_host_busy";
export const DEFAULT_BUSY_TIMEOUT_MS = 120_000;
const DEFAULT_BUSY_RETRY_BASE_MS = 250;
const MAX_BUSY_RETRY_DELAY_MS = 2_000;
const PIPE_NAME_RE = /^[A-Za-z0-9._-]{1,128}$/;
const sleepArray = new Int32Array(new SharedArrayBuffer(4));

function sleepSync(milliseconds) {
  Atomics.wait(sleepArray, 0, 0, milliseconds);
}

export function normalizePipeName(value = DEFAULT_AUTHORITY_PIPE) {
  const name = String(value || "").trim();
  if (!PIPE_NAME_RE.test(name)) throw new Error("authority_pipe_name_invalid");
  return name;
}

export function authorityPipePath(pipeName = DEFAULT_AUTHORITY_PIPE) {
  return `\\\\.\\pipe\\${normalizePipeName(pipeName)}`;
}

export function encodeAuthorityFrame(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  if (payload.length === 0 || payload.length > MAX_AUTHORITY_FRAME_BYTES) {
    throw new Error("authority_frame_too_large");
  }
  const frame = Buffer.allocUnsafe(payload.length + 4);
  frame.writeUInt32LE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

export function decodeAuthorityFrame(frame) {
  if (!Buffer.isBuffer(frame) || frame.length < 4) throw new Error("authority_frame_invalid");
  const length = frame.readUInt32LE(0);
  if (length === 0 || length > MAX_AUTHORITY_FRAME_BYTES) {
    throw new Error("authority_frame_too_large");
  }
  if (frame.length !== length + 4) throw new Error("authority_frame_length_mismatch");
  try {
    const value = JSON.parse(frame.subarray(4).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("not_object");
    }
    return value;
  } catch (error) {
    if (String(error?.message || "").startsWith("authority_")) throw error;
    throw new Error("authority_frame_json_invalid");
  }
}

function writeAll(fd, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const written = writeSync(fd, buffer, offset, buffer.length - offset);
    if (written <= 0) throw new Error("authority_pipe_write_failed");
    offset += written;
  }
}

function readExact(fd, length) {
  const buffer = Buffer.allocUnsafe(length);
  let offset = 0;
  while (offset < length) {
    const count = readSync(fd, buffer, offset, length - offset, null);
    if (count <= 0) throw new Error("authority_pipe_closed");
    offset += count;
  }
  return buffer;
}

function openPipeWithRetry(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() <= deadline) {
    try {
      return openSync(path, fsConstants.O_RDWR);
    } catch (error) {
      lastError = error;
      if (!["ENOENT", "EBUSY", "EACCES", "EPERM"].includes(error?.code)) throw error;
      sleepSync(40);
    }
  }
  const detail = lastError?.code ? `:${lastError.code}` : "";
  throw new Error(`authority_host_unavailable${detail}`);
}

export function callAuthorityHostSync({
  pipeName = DEFAULT_AUTHORITY_PIPE,
  method,
  params = {},
  timeoutMs = 5_000,
  id = randomUUID(),
} = {}) {
  if (process.platform !== "win32") throw new Error("authority_host_windows_only");
  if (typeof method !== "string" || !method) throw new Error("authority_method_required");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("authority_timeout_invalid");

  const request = {
    protocol: AUTHORITY_PROTOCOL,
    id,
    method,
    params,
  };
  const outgoing = encodeAuthorityFrame(request);
  const fd = openPipeWithRetry(authorityPipePath(pipeName), Math.floor(timeoutMs));
  try {
    writeAll(fd, outgoing);
    const header = readExact(fd, 4);
    const responseLength = header.readUInt32LE(0);
    if (responseLength === 0 || responseLength > MAX_AUTHORITY_FRAME_BYTES) {
      throw new Error("authority_frame_too_large");
    }
    const body = readExact(fd, responseLength);
    const frame = Buffer.concat([header, body]);
    const response = decodeAuthorityFrame(frame);
    if (response.protocol !== AUTHORITY_PROTOCOL) throw new Error("authority_protocol_mismatch");
    if (response.id !== id) throw new Error("authority_response_id_mismatch");
    if (response.ok !== true) {
      const code = String(response.error?.code || "unknown").replace(/[^A-Za-z0-9_.-]/g, "_");
      throw new Error(`authority_host_error:${code}`);
    }
    if (!response.result || typeof response.result !== "object" || Array.isArray(response.result)) {
      throw new Error("authority_result_invalid");
    }
    return response.result;
  } finally {
    closeSync(fd);
  }
}

export function authorizeBatchSync(operations, options = {}) {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error("authority_batch_operations_required");
  }
  const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
  const attempt = () => callAuthorityHostSync({
    ...options,
    method: "authorizeBatch",
    params: { operations },
  });
  if (options.disableBusyRetry === true) return attempt();
  return withBusyRetry(attempt, {
    busyTimeoutMs,
    busyRetryBaseMs: options.busyRetryBaseMs,
  });
}

export function redeemGrantSync({ grant, scopeSha256 }, options = {}) {
  if (typeof grant !== "string" || !grant.startsWith("gd1.")) {
    throw new Error("authority_grant_invalid");
  }
  if (!/^[0-9a-f]{64}$/i.test(String(scopeSha256 || ""))) {
    throw new Error("authority_scope_hash_invalid");
  }
  return callAuthorityHostSync({
    ...options,
    method: "redeemGrant",
    params: { grant, scopeSha256 },
  });
}

export function withBusyRetry(call, options = {}) {
  if (typeof call !== "function") throw new Error("authority_busy_retry_call_required");
  const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
  const busyRetryBaseMs = options.busyRetryBaseMs ?? DEFAULT_BUSY_RETRY_BASE_MS;
  if (!Number.isFinite(busyTimeoutMs) || busyTimeoutMs <= 0) throw new Error("authority_busy_timeout_invalid");
  if (!Number.isFinite(busyRetryBaseMs) || busyRetryBaseMs <= 0) throw new Error("authority_busy_retry_base_invalid");

  const deadline = Date.now() + busyTimeoutMs;
  let attempt = 0;
  for (;;) {
    try {
      return call();
    } catch (error) {
      if (String(error?.message || "") !== AUTHORITY_HOST_BUSY_ERROR) throw error;
      if (Date.now() >= deadline) {
        throw new Error(
          "authority_host_still_busy:wait_for_pending_hello",
        );
      }
      const delay = Math.min(
        busyRetryBaseMs * 2 ** attempt,
        MAX_BUSY_RETRY_DELAY_MS,
      );
      attempt += 1;
      sleepSync(delay);
    }
  }
}

export function makeAuthorityRedeemer(options = {}) {
  return ({ token, scopeSha256 }) => redeemGrantSync(
    { grant: token, scopeSha256 },
    options,
  );
}
