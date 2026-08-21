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

function parseJson(output, code) {
  try {
    return JSON.parse(String(output || "null"));
  } catch {
    throw new Error(code);
  }
}

function runOrThrow(runner, args, code) {
  const result = runner("gh", args, {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result?.status !== 0) {
    const detail = String(result?.stderr || result?.stdout || "").trim();
    throw new Error(`${code}${detail ? `:${detail}` : ""}`);
  }
  return String(result?.stdout || "");
}

function parseOpenPulls(output) {
  return normalizePullPages(parseJson(output || "[]", "merge_stack_pr_pages_invalid_json"));
}

export function nativeStackIdentity(stack) {
  if (stack === undefined) {
    return { queried: false, present: false, complete: false, size: null };
  }
  if (stack === null) {
    return { queried: true, present: false, complete: true, size: null };
  }
  if (typeof stack !== "object") {
    return { queried: true, present: true, complete: false, size: null };
  }
  const size = Number(stack.size);
  const sizeOk = Number.isInteger(size) && size >= 1;
  return {
    queried: true,
    present: true,
    complete: sizeOk,
    size: sizeOk ? size : null,
  };
}

export function nativeStackFromSnapshot(snapshot = {}) {
  const pr = snapshot?.evidence?.pullRequest;
  if (pr && Object.prototype.hasOwnProperty.call(pr, "stack")) {
    return nativeStackIdentity(pr.stack);
  }
  const policyStack = snapshot?.evidence?.policy?.nativeStack;
  if (policyStack && policyStack.queried === true) {
    return nativeStackIdentity(
      Object.prototype.hasOwnProperty.call(policyStack, "stack")
        ? policyStack.stack
        : null,
    );
  }
  return nativeStackIdentity(undefined);
}

export function nativeStackShipGateUnknowns(snapshot = {}) {
  const identity = nativeStackFromSnapshot(snapshot);
  if (!identity.queried || (identity.present && !identity.complete)) {
    return ["policy:native_stack_unreadable"];
  }
  if (identity.present) return ["policy:native_stack_unsupported"];
  return [];
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

  const native = nativeStackIdentity(target.stack);
  if (native.present) {
    return {
      eligible: false,
      reason: native.complete ? "native_stack_unsupported" : "native_stack_unreadable",
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
  const openPulls = parseOpenPulls(
    runOrThrow(
      runner,
      ["api", `repos/${repo}/pulls?state=open&per_page=100`, "--paginate", "--slurp"],
      "merge_stack_evidence_unreadable",
    ),
  );
  const decision = evaluateMergeStackEligibility({ prs: openPulls, targetPr: pr });
  if (decision.eligible) return decision;

  if (decision.reason === "stack_target_pr_missing") {
    const target = parseJson(
      runOrThrow(runner, ["api", `repos/${repo}/pulls/${pr}`], "merge_stack_target_unreadable"),
      "merge_stack_target_invalid_json",
    );
    if (target?.merged_at || target?.merged === true) {
      return {
        eligible: true,
        reason: null,
        pr,
        parentPr: null,
        alreadyMerged: true,
      };
    }
  }

  const parent = decision.parentPr ? `:parent_pr=${decision.parentPr}` : "";
  throw new Error(`${decision.reason}${parent}`);
}
