import {
  extractTldrBullets,
  extractVerdictLabel,
} from "./verdict-publication.mjs";
import { verifyNativeReviewSidecarPostcondition } from "./native-review-sidecar.mjs";

function normalizedGateSummary(body) {
  return String(extractTldrBullets(body)?.gate || "")
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function authoritativeGateNotReady(shipGate) {
  return (
    shipGate?.blocked === true ||
    shipGate?.unknown === true ||
    shipGate?.decision === "blocked" ||
    shipGate?.decision === "unknown"
  );
}

function claimsNoGateBlocker(summary) {
  return /^(?:none|clear|ready|no blockers?)\b/.test(summary);
}

export function verifyReviewVerdictCompletion({
  body,
  reviews = [],
  viewerLogin,
  shipGate,
} = {}) {
  const label = extractVerdictLabel(body);
  const problems = [];

  if (!label) {
    problems.push("verdict_label_missing");
  }

  const sidecar = verifyNativeReviewSidecarPostcondition({
    label,
    viewerLogin,
    reviews,
  });
  if (!sidecar.valid && sidecar.reason) {
    problems.push(sidecar.reason);
  }

  const gateSummary = normalizedGateSummary(body);
  if (!gateSummary) {
    problems.push("verdict_gate_summary_missing");
  } else if (
    authoritativeGateNotReady(shipGate) &&
    claimsNoGateBlocker(gateSummary)
  ) {
    problems.push("verdict_gate_summary_contradicts_ship_gate");
  }

  return {
    valid: problems.length === 0,
    problems,
    label,
    gateSummary,
    sidecar,
    shipGateDecision: shipGate?.decision || null,
    shipGateBlockers: Array.isArray(shipGate?.blockers)
      ? shipGate.blockers
      : [],
    shipGateUnknowns: Array.isArray(shipGate?.unknowns)
      ? shipGate.unknowns
      : [],
  };
}
