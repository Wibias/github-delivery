import { buildGraph, normalizePullPages, stackRefKey } from "../inspect-stack.mjs";

function required(value, name) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`${name}_required`);
  }
  return value;
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${name}_invalid`);
  return number;
}

function parseOpenPulls(output) {
  let payload;
  try {
    payload = JSON.parse(String(output || "[]"));
  } catch {
    throw new Error("merge_stack_pr_pages_invalid_json");
  }
  return normalizePullPages(payload);
}

export function evaluateMergeStackEligibility({ prs = [], targetPr } = {}) {
  const number = positiveInteger(targetPr, "pr");
  const target = prs.find((pr) => pr.number === number);
  if (!target) {
    return {
      eligible: false,
      reason: "stack_target_pr_missing",
      pr: number,
      parentPr: null,
    };
  }

  const { byHead } = buildGraph(prs);
  const parent = byHead.get(stackRefKey(target.baseRepoFullName, target.baseRefName)) || null;
  if (parent) {
    return {
      eligible: false,
      reason: "stack_parent_unlanded",
      pr: number,
      parentPr: parent.number,
      parentHeadRepo: parent.headRepoFullName,
      parentHeadRef: parent.headRefName,
      baseRepo: target.baseRepoFullName,
      baseRef: target.baseRefName,
    };
  }

  return {
    eligible: true,
    reason: null,
    pr: number,
    parentPr: null,
    baseRepo: target.baseRepoFullName,
    baseRef: target.baseRefName,
  };
}

export function verifyMergeStackEligibility({ request, runner } = {}) {
  if (request?.action !== "merge_pr") return null;
  if (typeof runner !== "function") throw new Error("merge_stack_runner_required");
  const repo = required(request.repo, "repo");
  const pr = positiveInteger(request.pr, "pr");
  const result = runner(
    "gh",
    ["api", `repos/${repo}/pulls?state=open&per_page=100`, "--paginate", "--slurp"],
    { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 },
  );
  if (result?.status !== 0) {
    const detail = String(result?.stderr || result?.stdout || "").trim();
    throw new Error(`merge_stack_evidence_unreadable${detail ? `:${detail}` : ""}`);
  }
  const decision = evaluateMergeStackEligibility({
    prs: parseOpenPulls(result?.stdout),
    targetPr: pr,
  });
  if (!decision.eligible) {
    const parent = decision.parentPr ? `:parent_pr=${decision.parentPr}` : "";
    throw new Error(`${decision.reason}${parent}`);
  }
  return decision;
}
