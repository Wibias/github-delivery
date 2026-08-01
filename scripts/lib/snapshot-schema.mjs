import { createHash } from "node:crypto";

function sourceEntries(sources) {
  return Object.entries(sources || {}).sort(([a], [b]) => a.localeCompare(b));
}

export function summarizeSources(sources = {}) {
  const entries = sourceEntries(sources);
  const required = entries.filter(([, source]) => source?.required !== false);
  const incomplete = required
    .filter(([, source]) => source?.complete !== true)
    .map(([name, source]) => ({
      source: name,
      error: source?.error || "source incomplete",
    }));
  return {
    total: entries.length,
    required: required.length,
    complete: required.length - incomplete.length,
    incomplete,
  };
}

export function createSnapshotEnvelope({
  repo,
  pr,
  headOid = null,
  capturedAt = new Date().toISOString(),
  sources = {},
  evidence = {},
} = {}) {
  const sourceSummary = summarizeSources(sources);
  const identity = JSON.stringify({ repo, pr, headOid, capturedAt });
  const snapshotId = createHash("sha256").update(identity).digest("hex");
  return {
    schemaVersion: 1,
    kind: "shipping-github/evidence-snapshot",
    snapshotId,
    capturedAt,
    repo,
    pr,
    headOid,
    complete: sourceSummary.incomplete.length === 0,
    incompleteReasons: sourceSummary.incomplete,
    sourceSummary,
    sources,
    evidence,
  };
}
