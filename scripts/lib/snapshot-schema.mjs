import { createHash } from "node:crypto";

function sourceEntries(sources) {
  return Object.entries(sources || {}).sort(([a], [b]) => a.localeCompare(b));
}

function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("snapshot_integrity_number_invalid");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw new Error("snapshot_integrity_value_invalid");
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

export function snapshotIntegritySha256(snapshot = {}) {
  const payload = structuredClone(snapshot || {});
  delete payload.snapshotId;
  delete payload.integritySha256;
  return createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
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
  const envelope = {
    schemaVersion: 1,
    kind: "github-delivery/evidence-snapshot",
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
  const integritySha256 = snapshotIntegritySha256(envelope);
  return {
    ...envelope,
    snapshotId: integritySha256,
    integritySha256,
  };
}
