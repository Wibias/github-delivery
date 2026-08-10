const CLOSED_STATUSES = new Set(["done", "clean", "findings", "confirmed", "dismissed"]);
const OPEN_STATUSES = new Set(["manual-review", "unreviewed", "needs-more-evidence", "unknown"]);
const KIND_ORDER = new Map([["lens", 0], ["surface", 1], ["probe", 2]]);

function normalizeRequirements(values, fallbackFiles) {
  if (!Array.isArray(values)) return [];
  return values.flatMap((value) => {
    if (typeof value === "string") return [{ id: value, files: [...fallbackFiles] }];
    if (!value || typeof value !== "object" || !value.id) return [];
    return [{ id: value.id, files: Array.isArray(value.files) && value.files.length ? [...new Set(value.files)] : [...fallbackFiles] }];
  });
}

function key(file, kind, id) {
  return `${file}\u0000${kind}\u0000${id}`;
}

function evidenceState(item) {
  if (!item || typeof item !== "object") return { closed: false, reason: "missing evidence" };
  if (item.status === "n-a") {
    return item.reason && String(item.reason).trim()
      ? { closed: true, reason: "n-a with concrete reason" }
      : { closed: false, reason: "invalid n-a evidence: concrete reason required" };
  }
  if (CLOSED_STATUSES.has(item.status)) return { closed: true, reason: `closed by ${item.status}` };
  if (OPEN_STATUSES.has(item.status)) return { closed: false, reason: `unresolved ${item.status} evidence` };
  return { closed: false, reason: item.status ? `unresolved evidence status ${item.status}` : "missing evidence status" };
}

function compareCoverageCells(a, b) {
  return a.file.localeCompare(b.file)
    || (KIND_ORDER.get(a.kind) ?? Number.MAX_SAFE_INTEGER) - (KIND_ORDER.get(b.kind) ?? Number.MAX_SAFE_INTEGER)
    || a.kind.localeCompare(b.kind)
    || a.id.localeCompare(b.id);
}

export function planCoverageGapFill(input = {}) {
  const files = [...new Set(Array.isArray(input.files) ? input.files.filter(Boolean) : [])];
  const required = input.required || {};
  const obligations = [
    ...normalizeRequirements(required.bugLenses, files).flatMap((item) => item.files.map((file) => ({ axis: "bug", kind: "lens", id: item.id, file }))),
    ...normalizeRequirements(required.securitySurfaces, files).flatMap((item) => item.files.map((file) => ({ axis: "security", kind: "surface", id: item.id, file }))),
    ...normalizeRequirements(required.probes, files).flatMap((item) => item.files.map((file) => ({ axis: "review", kind: "probe", id: item.id, file }))),
  ];

  const evidenceByCell = new Map();
  for (const item of Array.isArray(input.evidence) ? input.evidence : []) {
    if (!item?.file || !item?.kind || !item?.id) continue;
    const cellKey = key(item.file, item.kind, item.id);
    if (!evidenceByCell.has(cellKey)) evidenceByCell.set(cellKey, []);
    evidenceByCell.get(cellKey).push(item);
  }

  const targets = [];
  const closed = [];
  for (const obligation of obligations) {
    const records = evidenceByCell.get(key(obligation.file, obligation.kind, obligation.id)) || [];
    const states = records.map(evidenceState);
    const closingState = states.find((state) => state.closed);
    if (closingState) {
      closed.push({ ...obligation, reason: closingState.reason });
      continue;
    }
    const invalidNa = states.find((state) => state.reason === "invalid n-a evidence: concrete reason required");
    const unresolved = states.find((state) => state.reason.startsWith("unresolved"));
    targets.push({
      ...obligation,
      reason: invalidNa?.reason || unresolved?.reason || "missing evidence",
      evidenceCount: records.length,
    });
  }

  targets.sort(compareCoverageCells);
  closed.sort(compareCoverageCells);

  return {
    schemaVersion: 1,
    kind: "github-delivery/review-coverage-gap-fill",
    complete: targets.length === 0,
    obligationCount: obligations.length,
    closedCount: closed.length,
    targetCount: targets.length,
    targets,
    closed,
    instructions: [
      "Target uncovered or unresolved cells only; do not rescan completed cells merely to increase reviewer count.",
      "Prefer the narrowest reviewer/tool/method that can close each file × lens/surface/probe gap.",
      "manual-review, unreviewed, needs-more-evidence, and unknown remain open until settled or explicitly carried as residual blockers.",
      "n-a closes a required cell only with a concrete reason.",
      "A clean review claim is invalid while required targets remain open.",
    ],
  };
}
