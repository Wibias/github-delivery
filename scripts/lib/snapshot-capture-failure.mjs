const MAX_FAILURE_TEXT_CHARS = 2_000;
const SNAPSHOT_FAILURE_KIND = "github-delivery/ship-gate-snapshot-error";

function boundedText(value) {
  if (value === undefined || value === null || value === "") return null;
  const compact = String(value).replace(/\s+/g, " ").trim();
  if (compact.length <= MAX_FAILURE_TEXT_CHARS) return compact;
  return `${compact.slice(0, MAX_FAILURE_TEXT_CHARS)}...[truncated]`;
}

export function snapshotCaptureFailurePayload(error) {
  return {
    schemaVersion: 1,
    kind: SNAPSHOT_FAILURE_KIND,
    code: boundedText(error?.code) || "snapshot_capture_failed",
    message: boundedText(error?.message || error) || "snapshot_capture_failed",
    causeMessage: boundedText(error?.causeMessage),
  };
}

export function decodeSnapshotCaptureFailure(value) {
  let payload = value;
  if (typeof value === "string") {
    try {
      payload = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!payload || payload.kind !== SNAPSHOT_FAILURE_KIND) return null;

  const error = new Error(boundedText(payload.message) || "snapshot_capture_failed");
  error.code = boundedText(payload.code) || "snapshot_capture_failed";
  const causeMessage = boundedText(payload.causeMessage);
  if (causeMessage) error.causeMessage = causeMessage;
  return error;
}
