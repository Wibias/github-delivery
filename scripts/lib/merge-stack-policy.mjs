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

function repoParts(repo) {
  const parts = String(repo || "").split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("repo_invalid");
  return { owner: parts[0], name: parts[1] };
}

function flattenPages(value, code) {
  if (!Array.isArray(value)) throw new Error(code);
  return value.flatMap((page) => Array.isArray(page) ? page : [page]);
}

function rulesetPath(repo, rule) {
  const id = Number(rule?.ruleset_id);
  const sourceType = String(rule?.ruleset_source_type || "");
  const source = String(rule?.ruleset_source || "");
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("conversation_resolution_ruleset_id_missing");
  if (sourceType === "Repository") return `repos/${repo}/rulesets/${id}`;
  if (sourceType === "Organization" && source) return `orgs/${source}/rulesets/${id}`;
  if (sourceType === "Enterprise" && source) return `enterprises/${source}/rulesets/${id}`;
  throw new Error(`conversation_resolution_ruleset_source_unsupported:${sourceType || "missing"}`);
}

function nonBypassableConversationRule({ repo, rule, runner }) {
  const details = parseJson(
    runOrThrow(runner, ["api", rulesetPath(repo, rule)], "conversation_resolution_ruleset_unreadable"),
    "conversation_resolution_ruleset_invalid_json",
  );
  const bypassActors = details?.bypass_actors;
  const currentUserCanBypass = String(details?.current_user_can_bypass || "").toLowerCase();
  return (
    String(details?.enforcement || "").toLowerCase() === "active" &&
    Array.isArray(bypassActors) && bypassActors.length === 0 &&
    currentUserCanBypass === "never"
  );
}

function reviewThreadPages({ repo, pr, runner }) {
  const { owner, name } = repoParts(repo);
  const query = `
    query($owner:String!,$name:String!,$number:Int!,$endCursor:String) {
      repository(owner:$owner,name:$name) {
        pullRequest(number:$number) {
          headRefOid
          baseRefName
          reviewThreads(first:100,after:$endCursor) {
            nodes { id isResolved }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    }
  `;
  const payload = parseJson(
    runOrThrow(
      runner,
      [
        "api",
        "graphql",
        "--paginate",
        "--slurp",
        "-f",
        `query=${query}`,
        "-F",
        `owner=${owner}`,
        "-F",
        `name=${name}`,
        "-F",
        `number=${pr}`,
      ],
      "merge_review_threads_unreadable",
    ),
    "merge_review_threads_invalid_json",
  );
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error("merge_review_threads_incomplete");
  }
  return payload;
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

export function verifyMergeConversationSafety({ request, runner } = {}) {
  if (request?.action !== "merge_pr") return null;
  if (typeof runner !== "function") throw new Error("merge_conversation_runner_required");
  const repo = String(required(request.repo, "repo"));
  const pr = positiveInteger(request.pr, "pr");
  const expectedHead = String(required(request.expectedHead, "expected_head")).toLowerCase();
  const expectedBase = String(required(request.expectedBase, "expected_base"));

  const current = parseJson(
    runOrThrow(
      runner,
      ["pr", "view", String(pr), "--repo", repo, "--json", "headRefOid,baseRefName"],
      "merge_conversation_pr_unreadable",
    ),
    "merge_conversation_pr_invalid_json",
  );
  const observedHead = String(current?.headRefOid || "").toLowerCase();
  const observedBase = String(current?.baseRefName || "");
  if (observedHead !== expectedHead) {
    throw new Error(`expected_head_mismatch: expected ${expectedHead}, observed ${observedHead || "missing"}`);
  }
  if (observedBase !== expectedBase) {
    throw new Error(`expected_base_mismatch: expected ${expectedBase}, observed ${observedBase || "missing"}`);
  }

  const rulesPayload = parseJson(
    runOrThrow(
      runner,
      [
        "api",
        `repos/${repo}/rules/branches/${encodeURIComponent(expectedBase)}?per_page=100`,
        "--paginate",
        "--slurp",
      ],
      "conversation_resolution_rules_unreadable",
    ),
    "conversation_resolution_rules_invalid_json",
  );
  const rules = flattenPages(rulesPayload, "conversation_resolution_rules_invalid_payload");
  const enforcingRules = rules.filter(
    (rule) =>
      rule?.type === "pull_request" &&
      rule?.parameters?.required_review_thread_resolution === true,
  );
  if (enforcingRules.length === 0) throw new Error("conversation_resolution_not_enforced");
  if (!enforcingRules.some((rule) => nonBypassableConversationRule({ repo, rule, runner }))) {
    throw new Error("conversation_resolution_bypass_unproven");
  }

  const pages = reviewThreadPages({ repo, pr, runner });
  const threads = [];
  for (const page of pages) {
    if (page?.errors?.length) throw new Error("merge_review_threads_graphql_error");
    const pull = page?.data?.repository?.pullRequest;
    if (!pull) throw new Error("merge_review_threads_pr_missing");
    if (String(pull.headRefOid || "").toLowerCase() !== expectedHead) {
      throw new Error("merge_review_threads_head_mismatch");
    }
    if (String(pull.baseRefName || "") !== expectedBase) {
      throw new Error("merge_review_threads_base_mismatch");
    }
    const reviewThreads = pull.reviewThreads;
    if (!reviewThreads || !Array.isArray(reviewThreads.nodes)) {
      throw new Error("merge_review_threads_incomplete");
    }
    threads.push(...reviewThreads.nodes);
  }
  const lastPageInfo = pages.at(-1)?.data?.repository?.pullRequest?.reviewThreads?.pageInfo;
  if (!lastPageInfo || lastPageInfo.hasNextPage === true) {
    throw new Error("merge_review_threads_incomplete");
  }
  const unresolved = threads.filter((thread) => thread?.isResolved === false);
  if (unresolved.length > 0) {
    throw new Error(`unresolved_review_threads:${unresolved.map((thread) => thread?.id || "unknown").join(",")}`);
  }

  return {
    safe: true,
    repo,
    pr,
    expectedHead,
    expectedBase,
    conversationResolutionEnforced: true,
    unresolvedCount: 0,
    reviewedThreadCount: threads.length,
  };
}
