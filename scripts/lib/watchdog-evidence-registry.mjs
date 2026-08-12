const OWNED_HELPERS = Object.freeze({
  "ci-forensics.mjs": {
    effect: "evidence",
    keyKind: "pr-ci",
    authoritative: true,
    covers: ["checks", "failure-origin", "annotations", "failure-log-tail"],
  },
  "runtime-capabilities.mjs": {
    effect: "evidence",
    keyKind: "runtime-capabilities",
    authoritative: true,
    covers: ["runtime-capabilities"],
  },
  "review-brief.mjs": {
    effect: "evidence",
    keyKind: "pr-review-brief",
    authoritative: true,
    covers: ["scope", "diff", "review-lenses", "required-probes"],
  },
  "ship-gate.mjs": {
    effect: "evidence",
    keyKind: "pr-ship-gate",
    authoritative: true,
    covers: ["ship-gate", "checks", "review-state", "mergeability"],
  },
});

function normalizeRepo(value) {
  const repo = String(value || "").trim().replace(/^['"]|['"]$/g, "");
  return /^[^/\s]+\/[^/\s]+$/.test(repo) ? repo : null;
}

function parsePositiveInteger(value) {
  const parsed = Number(String(value || "").replace(/^['"]|['"]$/g, ""));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function helperName(command) {
  const match = String(command || "").match(
    /\bnode(?:\.exe)?\s+(?:['"]?[^\s'"]*[\\/])?([^\\/\s'"]+\.mjs)\b/i,
  );
  return match?.[1]?.toLowerCase() || null;
}

function repoFlag(command) {
  const value = String(command || "");
  const match = value.match(/(?:^|\s)(?:-R|--repo)(?:=|\s+)(['"]?[^\s'"]+\/[^\s'"]+['"]?)/i);
  return normalizeRepo(match?.[1]);
}

function ghRunDescriptor(command) {
  const value = String(command || "");
  const match = value.match(/\bgh(?:\.exe)?\b[\s\S]*?\brun\s+view\s+(\d+)\b/i);
  if (!match) return null;
  const runId = parsePositiveInteger(match[1]);
  if (!runId) return null;
  const repo = repoFlag(value) || "current";
  return {
    effect: "evidence",
    key: `github-actions-run:${repo}:${runId}`,
    authoritative: true,
    covers: ["run-state", "failure-log-tail"],
  };
}

function helperDescriptor(command) {
  const name = helperName(command);
  const manifest = name ? OWNED_HELPERS[name] : null;
  if (!manifest) return null;

  const value = String(command || "");
  const afterScript = value.slice(value.toLowerCase().indexOf(name) + name.length).trim();
  const positional = afterScript
    .split(/\s+/)
    .filter(Boolean)
    .filter((part) => !part.startsWith("-"));

  let repo = null;
  let subject = null;
  if (name === "runtime-capabilities.mjs") {
    repo = repoFlag(value) || normalizeRepo(positional[0]) || "current";
  } else {
    repo = normalizeRepo(positional[0]) || repoFlag(value) || "current";
    subject = parsePositiveInteger(positional[1]);
  }

  const key = subject
    ? `${manifest.keyKind}:${repo}:${subject}`
    : `${manifest.keyKind}:${repo}`;
  return {
    effect: manifest.effect,
    key,
    authoritative: manifest.authoritative,
    covers: [...manifest.covers],
  };
}

export function ownedHelperEffect(name) {
  const base = String(name || "").replace(/\\/g, "/").split("/").pop().toLowerCase();
  const manifest = OWNED_HELPERS[base];
  return manifest
    ? {
        effect: manifest.effect,
        authoritative: manifest.authoritative,
        covers: [...manifest.covers],
      }
    : null;
}

export function deriveShellEvidenceDescriptor(command) {
  return helperDescriptor(command) || ghRunDescriptor(command);
}

function entryKey(stateGeneration, key) {
  return `${Number(stateGeneration) || 0}\0${String(key || "")}`;
}

function sortedUnique(values) {
  return [...new Set((values || []).map(String).filter(Boolean))].sort();
}

export function createEvidenceRegistry(snapshot = null) {
  const entries = new Map();
  for (const raw of snapshot?.entries || []) {
    if (!raw?.key) continue;
    const generation = Number.isInteger(raw.stateGeneration) && raw.stateGeneration >= 0
      ? raw.stateGeneration
      : 0;
    entries.set(entryKey(generation, raw.key), {
      stateGeneration: generation,
      key: String(raw.key),
      covers: new Set(sortedUnique(raw.covers)),
      authoritative: Boolean(raw.authoritative),
    });
  }

  function record({ stateGeneration = 0, key, covers = [], authoritative = false } = {}) {
    if (!key) throw new Error("evidence key is required");
    const generation = Number.isInteger(stateGeneration) && stateGeneration >= 0
      ? stateGeneration
      : 0;
    const id = entryKey(generation, key);
    const prior = entries.get(id) || {
      stateGeneration: generation,
      key: String(key),
      covers: new Set(),
      authoritative: false,
    };
    for (const dimension of sortedUnique(covers)) prior.covers.add(dimension);
    prior.authoritative = prior.authoritative || Boolean(authoritative);
    entries.set(id, prior);
    return {
      stateGeneration: generation,
      key: prior.key,
      covers: [...prior.covers].sort(),
      authoritative: prior.authoritative,
    };
  }

  function decide({ stateGeneration = 0, key, requires = [] } = {}) {
    if (!key) throw new Error("evidence key is required");
    const generation = Number.isInteger(stateGeneration) && stateGeneration >= 0
      ? stateGeneration
      : 0;
    const needed = sortedUnique(requires);
    const prior = entries.get(entryKey(generation, key));
    const missing = prior
      ? needed.filter((dimension) => !prior.covers.has(dimension))
      : needed;
    if (prior?.authoritative && needed.length > 0 && missing.length === 0) {
      return {
        action: "block",
        reason: "evidence_already_covered",
        missing: [],
      };
    }
    return { action: "allow", missing };
  }

  function snapshotState() {
    return {
      schemaVersion: 1,
      entries: [...entries.values()]
        .map((entry) => ({
          stateGeneration: entry.stateGeneration,
          key: entry.key,
          covers: [...entry.covers].sort(),
          authoritative: entry.authoritative,
        }))
        .sort((a, b) =>
          a.stateGeneration - b.stateGeneration || a.key.localeCompare(b.key),
        ),
    };
  }

  return {
    record,
    decide,
    snapshot: snapshotState,
  };
}
