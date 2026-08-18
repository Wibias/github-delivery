import { createHash } from "node:crypto";

function requiredText(value, name) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${name}_required`);
  return text;
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${name}_invalid`);
  return number;
}

function repoName(value) {
  const text = requiredText(value, "repo");
  if (!/^[^/\s]+\/[^/\s]+$/.test(text)) throw new Error("repo_invalid");
  return text;
}

function exactSha(value, name = "head") {
  const text = requiredText(value, name).toLowerCase();
  if (!/^[0-9a-f]{40,64}$/.test(text)) throw new Error(`${name}_invalid`);
  return text;
}

function validRef(value, name) {
  const ref = requiredText(value, name);
  const components = ref.split("/");
  const invalidCharacter = ["~", "^", ":", "?", "*", "[", "\\"].some((character) => ref.includes(character));
  const invalidComponent = components.some((component) =>
    !component || component.startsWith(".") || component.endsWith(".lock"),
  );
  if (
    /[\x00-\x20\x7f]/.test(ref) || invalidCharacter || invalidComponent ||
    ref === "@" || ref.startsWith("-") || ref.includes("..") || ref.includes("@{") || ref.endsWith(".")
  ) {
    throw new Error(`${name}_invalid`);
  }
  return ref;
}

function slug(value) {
  return String(value).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "target";
}

function shortHash(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex").slice(0, 10);
}

function portBranch(sourcePr, targetBase) {
  return `github-delivery/port-${sourcePr}-to-${slug(targetBase)}-${shortHash(targetBase)}`;
}

function markerPayload({ repository, sourcePr, sourceHeadSha, targetBase }) {
  return `${repository}\u0000${sourcePr}\u0000${sourceHeadSha}\u0000${targetBase}`;
}

export function portProvenanceMarker(input = {}) {
  const repository = repoName(input.repository);
  const sourcePr = positiveInteger(input.sourcePr, "source_pr");
  const sourceHeadSha = exactSha(input.sourceHeadSha, "source_head");
  const targetBase = validRef(input.targetBase, "target_base");
  const digest = createHash("sha256").update(markerPayload({ repository, sourcePr, sourceHeadSha, targetBase })).digest("hex");
  return `<!-- github-delivery:port ${digest} -->`;
}

export function planMultiBaseDelivery({ repository, sourcePr, sourceHeadSha, sourceBase, targetBases = [], requiredBases = null } = {}) {
  const repo = repoName(repository);
  const pr = positiveInteger(sourcePr, "source_pr");
  const head = exactSha(sourceHeadSha, "source_head");
  const base = validRef(sourceBase, "source_base");
  const targets = [...new Set((targetBases || []).map((value) => validRef(value, "target_base")))];
  if (targets.length === 0) throw new Error("target_bases_required");
  if (targets.includes(base)) throw new Error(`target_base_matches_source:${base}`);

  const requiredSet = requiredBases === null
    ? new Set(targets)
    : new Set((requiredBases || []).map((value) => validRef(value, "required_base")));
  for (const required of requiredSet) {
    if (!targets.includes(required)) throw new Error(`required_base_not_targeted:${required}`);
  }

  const ports = targets.map((targetBase) => ({
    repository: repo,
    sourcePr: pr,
    sourceHeadSha: head,
    sourceBase: base,
    targetBase,
    required: requiredSet.has(targetBase),
    branch: portBranch(pr, targetBase),
    provenanceMarker: portProvenanceMarker({ repository: repo, sourcePr: pr, sourceHeadSha: head, targetBase }),
    topology: "parallel-port",
  }));

  return {
    schemaVersion: 1,
    kind: "github-delivery/multi-base-plan",
    repository: repo,
    sourcePr: pr,
    sourceHeadSha: head,
    sourceBase: base,
    ports,
  };
}

export function verifyPortPullRequest(port, observed = {}) {
  const number = positiveInteger(observed.number, "port_pr");
  const targetBase = requiredText(observed.base, "port_base");
  const body = String(observed.body ?? "");
  if (targetBase !== port.targetBase) {
    return { state: "mismatch", number, targetBase, reason: `port_base_mismatch:${targetBase}` };
  }
  if (!body.includes(port.provenanceMarker)) {
    return { state: "mismatch", number, targetBase, reason: "port_provenance_missing" };
  }
  return {
    state: "verified",
    number,
    targetBase,
    merged: observed.merged === true,
    url: observed.url ? String(observed.url) : null,
  };
}

export function summarizeMultiBaseDelivery({ plan, observedPullRequests = [] } = {}) {
  if (plan?.kind !== "github-delivery/multi-base-plan") throw new Error("multi_base_plan_required");
  const observations = new Map();
  const invalid = [];

  for (const observed of observedPullRequests || []) {
    const body = String(observed?.body ?? "");
    const matching = plan.ports.filter((port) => body.includes(port.provenanceMarker));
    if (matching.length === 0) continue;
    if (matching.length > 1) {
      invalid.push({
        number: Number(observed?.number) || null,
        reason: "port_provenance_ambiguous",
        targetBases: matching.map((port) => port.targetBase),
      });
      continue;
    }

    const port = matching[0];
    const verification = verifyPortPullRequest(port, observed);
    if (verification.state !== "verified") {
      invalid.push({
        number: verification.number,
        reason: verification.reason,
        expectedTargetBase: port.targetBase,
        observedTargetBase: verification.targetBase,
      });
      continue;
    }
    if (observations.has(port.targetBase)) throw new Error(`duplicate_port_pr:${port.targetBase}`);
    observations.set(port.targetBase, verification);
  }

  const ports = plan.ports.map((port) => {
    const observed = observations.get(port.targetBase) || null;
    return {
      ...port,
      observed,
      state: !observed ? "missing" : observed.merged ? "merged" : "open",
    };
  });
  const requiredIncomplete = ports.filter((port) => port.required && port.state !== "merged");
  return {
    state: invalid.length > 0 ? "invalid" : requiredIncomplete.length === 0 ? "complete" : "incomplete",
    ports,
    invalid,
    requiredIncomplete: requiredIncomplete.map((port) => port.targetBase),
  };
}
