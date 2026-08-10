const CLAIM_WEIGHTS = Object.freeze({
  "runtime-behavior": Object.freeze({
    "runtime-reproduction": 100,
    "executable-test": 90,
    "shipping-source": 80,
    "live-github-state": 75,
    "repository-spec": 55,
    "official-docs": 55,
    "maintainer-statement": 45,
    "primary-repository": 40,
    "primary-research": 35,
    "blog": 20,
    "forum": 10,
    "social-post": 8,
    "model-memory": 0,
  }),
  contract: Object.freeze({
    "repository-policy": 100,
    "repository-spec": 100,
    "official-docs": 90,
    "official-standard": 90,
    "maintainer-statement": 70,
    "shipping-source": 65,
    "executable-test": 60,
    "runtime-reproduction": 50,
    "primary-repository": 50,
    "primary-research": 45,
    "blog": 20,
    "forum": 10,
    "social-post": 8,
    "model-memory": 0,
  }),
  history: Object.freeze({
    commit: 100,
    "pull-request": 100,
    "issue-timeline": 95,
    release: 90,
    "live-github-state": 85,
    "maintainer-statement": 65,
    "shipping-source": 50,
    "official-docs": 35,
    "blog": 20,
    "forum": 10,
    "social-post": 8,
    "model-memory": 0,
  }),
  "external-prior-art": Object.freeze({
    "official-docs": 100,
    "official-standard": 100,
    "primary-repository": 95,
    "primary-research": 90,
    "maintainer-statement": 80,
    "shipping-source": 75,
    "blog": 50,
    "tutorial": 40,
    "forum": 25,
    "social-post": 20,
    "model-memory": 0,
  }),
});

function requireEvidence(item, index) {
  if (!item || typeof item !== "object" || Array.isArray(item)) throw new TypeError(`evidence[${index}] must be an object`);
  if (!item.id || typeof item.id !== "string") throw new TypeError(`evidence[${index}] requires id`);
  if (!item.kind || typeof item.kind !== "string") throw new TypeError(`evidence ${item.id} requires kind`);
  if (item.conclusion === undefined || item.conclusion === null || String(item.conclusion).trim() === "") {
    throw new TypeError(`evidence ${item.id} requires conclusion`);
  }
}

function headPenalties(item, claimType, currentHeadSha) {
  if (!currentHeadSha || claimType !== "runtime-behavior") return [];
  if (!["runtime-reproduction", "executable-test", "shipping-source", "live-github-state"].includes(item.kind)) return [];
  if (!item.headSha) return ["unbound-head"];
  if (item.headSha !== currentHeadSha) return ["stale-head"];
  return [];
}

function penaltyScore(penalties) {
  let total = 0;
  if (penalties.includes("stale-head")) total += 45;
  if (penalties.includes("unbound-head")) total += 50;
  return total;
}

export function rankResearchEvidence({ claimType, evidence = [], currentHeadSha = null } = {}) {
  const weights = CLAIM_WEIGHTS[claimType];
  if (!weights) throw new TypeError(`unknown research claim type: ${claimType || "<missing>"}`);
  if (!Array.isArray(evidence)) throw new TypeError("evidence must be an array");

  const ranked = evidence.map((item, index) => {
    requireEvidence(item, index);
    const penalties = headPenalties(item, claimType, currentHeadSha);
    const baseScore = weights[item.kind] ?? 5;
    return {
      ...structuredClone(item),
      baseScore,
      penalties,
      score: Math.max(0, baseScore - penaltyScore(penalties)),
    };
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const topScore = ranked[0]?.score ?? null;
  const top = topScore === null ? [] : ranked.filter((item) => item.score === topScore);
  const topConclusions = [...new Set(top.map((item) => String(item.conclusion)))];
  const conflicted = topConclusions.length > 1;

  return {
    schemaVersion: 1,
    kind: "github-delivery/research-evidence-ranking",
    claimType,
    currentHeadSha,
    ranked,
    topScore,
    topEvidenceIds: top.map((item) => item.id),
    topConclusions,
    conflicted,
    preferredConclusion: conflicted ? null : topConclusions[0] ?? null,
    instructions: [
      "Rank evidence by the claim being proved; one universal source hierarchy is unsafe.",
      "Do not average away contradictory top-tier evidence. Surface the conflict and gather discriminating evidence.",
      "For current runtime claims, exact-head runtime/test/source evidence loses authority when stale or unbound.",
      "Model memory is orientation only when stronger primary or observed evidence can be obtained.",
      "External secondary sources may explain or suggest hypotheses but do not overrule current primary/runtime evidence without a concrete reason.",
    ],
  };
}

export const RESEARCH_CLAIM_TYPES = Object.freeze(Object.keys(CLAIM_WEIGHTS));
