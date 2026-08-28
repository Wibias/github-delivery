const MAX_FAILURE_MESSAGE_CHARS = 2_000;
const LOCAL_INPUT_ERROR = /(?:\bENOENT\b|no such file|snapshot_(?:integrity|repo|pr|head|age)|invalid snapshot|usage: node scripts\/ship-gate\.mjs)/i;
const GITHUB_CAPABILITY_OR_PERMISSION_ERROR = /(?:\b(?:401|403)\b|forbidden|resource not accessible|requires? github pro|upgrade to github pro|must have admin(?:istrator)? rights?|insufficient permission)/i;
const TRANSIENT_UPSTREAM_ERROR = /(?:\b(?:408|429|500|502|503|504)\b|rate[ -]?limit|timed? ?out|\bETIMEDOUT\b|\bECONNRESET\b|\bEAI_AGAIN\b|\bENETUNREACH\b|socket hang up|temporar(?:y|ily) unavailable)/i;

function boundedFailureMessage(value) {
  const compact = String(value || "ship_gate_failed").replace(/\s+/g, " ").trim();
  if (compact.length <= MAX_FAILURE_MESSAGE_CHARS) return compact;
  return `${compact.slice(0, MAX_FAILURE_MESSAGE_CHARS)}...[truncated]`;
}

export function classifyShipGateFailure(error) {
  const rawMessage = String(error?.message || error || "ship_gate_failed");
  const message = boundedFailureMessage(rawMessage);
  const code = String(error?.code || "");
  const haystack = `${code} ${rawMessage}`;

  if (LOCAL_INPUT_ERROR.test(haystack)) {
    return { classification: "local_input_error", retryable: false, message };
  }
  if (GITHUB_CAPABILITY_OR_PERMISSION_ERROR.test(haystack)) {
    return {
      classification: "github_capability_or_permission_error",
      retryable: false,
      message,
    };
  }
  if (TRANSIENT_UPSTREAM_ERROR.test(haystack)) {
    return { classification: "transient_upstream_error", retryable: true, message };
  }
  return { classification: "unknown_error", retryable: null, message };
}

export function shipGateFailureOutput(error, { stage = "execution" } = {}) {
  const evidenceFailure = stage === "live_snapshot_capture" || stage === "snapshot_replay";
  return {
    schemaVersion: 1,
    kind: "github-delivery/ship-gate",
    decision: "unknown",
    ready: false,
    blocked: false,
    unknown: true,
    complete: false,
    authoritative: false,
    evidenceMode:
      stage === "snapshot_replay"
        ? "snapshot_replay"
        : stage === "live_snapshot_capture"
          ? "live_capture"
          : null,
    unknowns: [
      evidenceFailure ? "ship_gate_evidence_capture_failed" : "ship_gate_execution_failed",
    ],
    failure: {
      stage,
      ...classifyShipGateFailure(error),
    },
  };
}
