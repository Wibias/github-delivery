const NOISE_PATH_RE = /(^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|CHANGELOG\.md|README\.md)$/i;

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${name}_invalid`);
  return number;
}

function normalizedRepo(value, name) {
  const text = String(value ?? "").trim();
  if (!/^[^/\s]+\/[^/\s]+$/.test(text)) throw new Error(`${name}_invalid`);
  return text.toLowerCase();
}

function normalizeWorkItemKey(value) {
  const text = String(value ?? "").trim().toUpperCase();
  return /^[A-Z][A-Z0-9]*-\d+$/.test(text) ? text : null;
}

function normalizePullRequest(raw = {}) {
  const number = positiveInteger(raw.number, "pr_number");
  const repository = normalizedRepo(raw.repository, "pr_repository");
  const base = String(raw.base ?? "").trim();
  const headRepository = normalizedRepo(raw.headRepository ?? raw.repository, "pr_head_repository");
  const head = String(raw.head ?? "").trim();
  if (!base) throw new Error("pr_base_required");
  if (!head) throw new Error("pr_head_required");
  const files = [...new Set((raw.files || []).map((entry) => String(entry).trim()).filter(Boolean))].sort();
  return {
    number,
    repository,
    base,
    headRepository,
    head,
    title: String(raw.title ?? ""),
    workItemKey: normalizeWorkItemKey(raw.workItemKey),
    files,
  };
}

function overlap(left, right) {
  const leftFiles = new Set(left.files.filter((path) => !NOISE_PATH_RE.test(path)));
  const rightFiles = new Set(right.files.filter((path) => !NOISE_PATH_RE.test(path)));
  const shared = [...leftFiles].filter((path) => rightFiles.has(path));
  const denominator = Math.min(leftFiles.size, rightFiles.size);
  return {
    shared,
    ratio: denominator === 0 ? 0 : shared.length / denominator,
  };
}

function substantialImplementationOverlap(files) {
  return files.shared.length >= 2 && files.ratio >= 0.6;
}

function pairEvidence(left, right) {
  if (left.repository !== right.repository || left.base !== right.base) return null;
  const files = overlap(left, right);
  if (left.workItemKey && left.workItemKey === right.workItemKey) {
    const supersedeGrade = substantialImplementationOverlap(files);
    return {
      kind: "same_work_item",
      confidence: supersedeGrade ? "high" : "medium",
      workItemKey: left.workItemKey,
      sharedFiles: files.shared,
      overlapRatio: files.ratio,
      supersedeGrade,
    };
  }
  if (substantialImplementationOverlap(files)) {
    return {
      kind: "changed_file_overlap",
      confidence: "medium",
      workItemKey: null,
      sharedFiles: files.shared,
      overlapRatio: files.ratio,
      supersedeGrade: true,
    };
  }
  return null;
}

function connectedComponents(pulls, edges) {
  const adjacency = new Map(pulls.map((pull) => [pull.number, new Set()]));
  for (const edge of edges) {
    adjacency.get(edge.left).add(edge.right);
    adjacency.get(edge.right).add(edge.left);
  }
  const visited = new Set();
  const components = [];
  for (const pull of pulls) {
    if (visited.has(pull.number) || adjacency.get(pull.number).size === 0) continue;
    const stack = [pull.number];
    const numbers = [];
    visited.add(pull.number);
    while (stack.length) {
      const number = stack.pop();
      numbers.push(number);
      for (const next of adjacency.get(number)) {
        if (visited.has(next)) continue;
        visited.add(next);
        stack.push(next);
      }
    }
    components.push(numbers.sort((a, b) => a - b));
  }
  return components;
}

function supersedeEvidenceBetween(cluster, left, right) {
  return cluster.evidence.some((edge) =>
    edge.evidence.supersedeGrade === true &&
    ((edge.left === left && edge.right === right) ||
      (edge.left === right && edge.right === left)),
  );
}

export function analyzePrConsolidation(rawPulls = []) {
  const pulls = rawPulls.map(normalizePullRequest);
  const numbers = new Set();
  for (const pull of pulls) {
    if (numbers.has(pull.number)) throw new Error(`duplicate_pr_number:${pull.number}`);
    numbers.add(pull.number);
  }

  const edges = [];
  for (let i = 0; i < pulls.length; i += 1) {
    for (let j = i + 1; j < pulls.length; j += 1) {
      const evidence = pairEvidence(pulls[i], pulls[j]);
      if (!evidence) continue;
      edges.push({ left: pulls[i].number, right: pulls[j].number, evidence });
    }
  }

  const clusters = connectedComponents(pulls, edges).map((members) => {
    const memberSet = new Set(members);
    const clusterEdges = edges.filter((edge) => memberSet.has(edge.left) && memberSet.has(edge.right));
    const confidence = clusterEdges.some((edge) => edge.evidence.confidence === "high") ? "high" : "medium";
    return {
      members,
      confidence,
      evidence: clusterEdges,
      canonicalPr: null,
      selectionRequired: true,
    };
  });

  return {
    state: clusters.length ? "candidates" : "none",
    pulls,
    clusters,
  };
}

export function planPrConsolidation({ analysis, clusterMembers, canonicalPr } = {}) {
  if (analysis?.state !== "candidates") throw new Error("consolidation_candidates_required");
  const members = [...new Set((clusterMembers || []).map((value) => positiveInteger(value, "cluster_pr")))].sort((a, b) => a - b);
  if (members.length < 2) throw new Error("consolidation_cluster_too_small");
  const canonical = positiveInteger(canonicalPr, "canonical_pr");
  if (!members.includes(canonical)) throw new Error("canonical_pr_not_in_cluster");
  const matchingCluster = analysis.clusters.find((cluster) =>
    cluster.members.length === members.length && cluster.members.every((number, index) => number === members[index]),
  );
  if (!matchingCluster) throw new Error("consolidation_cluster_not_proven");

  const superseded = members.filter((number) => number !== canonical);
  const unproven = superseded.filter((number) => !supersedeEvidenceBetween(matchingCluster, canonical, number));
  if (unproven.length > 0) {
    throw new Error(`canonical_pr_missing_supersede_evidence:${canonical}:${unproven.join(",")}`);
  }

  return {
    state: "planned",
    canonicalPr: canonical,
    supersede: superseded.map((number) => ({
      pr: number,
      action: "delegate_supersede_pr",
      canonicalPr: canonical,
    })),
    evidence: matchingCluster.evidence,
  };
}
