#!/usr/bin/env node
/**
 * Resolve required CI checks against the PR head commit.
 *
 * Exit 0: ready
 * Exit 1: blocked by known check state or strict-update policy
 * Exit 2: unknown/incomplete evidence or usage/API failure
 *
 * Usage: node scripts/required-checks.mjs OWNER/REPO PR_NUMBER
 * Requires: gh auth
 */
import { spawnSync } from "node:child_process";
import {
  evaluateRequiredCheckCompleteness,
  evaluateRequiredChecks,
  normalizeRequiredChecks,
} from "./lib/required-checks-policy.mjs";

const [repo, prRaw] = process.argv.slice(2);
const pr = Number(prRaw);
if (!repo || !repo.includes("/") || !Number.isInteger(pr) || pr <= 0) {
  console.error("Usage: node scripts/required-checks.mjs OWNER/REPO PR_NUMBER");
  process.exit(2);
}
const [owner, name] = repo.split("/");

function ghOk(args) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function ghJson(args) {
  const result = ghOk(args);
  if (!result.ok) {
    const message = (result.stderr || result.stdout || "").trim();
    throw new Error(message || `gh failed: ${args.join(" ")}`);
  }
  try {
    return JSON.parse(result.stdout || "null");
  } catch {
    throw new Error(`gh returned invalid JSON: ${args.join(" ")}`);
  }
}

function patternMatchesBranch(pattern, branch) {
  if (!pattern) return false;
  if (pattern === branch) return true;
  const expression = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "<<<STARSTAR>>>")
    .replace(/\*/g, "[^/]*")
    .replace(/<<<STARSTAR>>>/g, ".*");
  return new RegExp(`^${expression}$`).test(branch);
}

function fetchPagedArray(path, label) {
  const rows = [];
  for (let page = 1; page <= 100; page++) {
    const separator = path.includes("?") ? "&" : "?";
    const response = ghOk([
      "api",
      `${path}${separator}per_page=100&page=${page}`,
    ]);
    if (!response.ok) {
      return {
        readable: false,
        complete: false,
        pages: page - 1,
        rows,
        error:
          (response.stderr || response.stdout || "").trim() ||
          `${label} request failed`,
      };
    }
    let chunk;
    try {
      chunk = JSON.parse(response.stdout);
    } catch {
      return {
        readable: false,
        complete: false,
        pages: page - 1,
        rows,
        error: `${label} returned invalid JSON`,
      };
    }
    if (!Array.isArray(chunk)) {
      return {
        readable: false,
        complete: false,
        pages: page - 1,
        rows,
        error: `${label} returned an unexpected payload`,
      };
    }
    rows.push(...chunk);
    if (chunk.length < 100) {
      return {
        readable: true,
        complete: true,
        pages: page,
        rows,
        error: null,
      };
    }
  }
  return {
    readable: true,
    complete: false,
    pages: 100,
    rows,
    error: `${label} exceeded pagination safety limit`,
  };
}

function fetchCheckRuns(sha) {
  const rows = [];
  let expectedTotal = null;
  for (let page = 1; page <= 100; page++) {
    const response = ghOk([
      "api",
      "-H",
      "Accept: application/vnd.github+json",
      `repos/${owner}/${name}/commits/${sha}/check-runs?per_page=100&page=${page}`,
    ]);
    if (!response.ok) {
      return {
        readable: false,
        complete: false,
        pages: page - 1,
        rows,
        error:
          (response.stderr || response.stdout || "").trim() ||
          "check-runs request failed",
      };
    }
    let payload;
    try {
      payload = JSON.parse(response.stdout);
    } catch {
      return {
        readable: false,
        complete: false,
        pages: page - 1,
        rows,
        error: "check-runs returned invalid JSON",
      };
    }
    const chunk = payload?.check_runs;
    if (!Array.isArray(chunk)) {
      return {
        readable: false,
        complete: false,
        pages: page - 1,
        rows,
        error: "check-runs returned an unexpected payload",
      };
    }
    if (Number.isInteger(payload.total_count)) expectedTotal = payload.total_count;
    rows.push(...chunk);
    if (
      chunk.length < 100 ||
      (expectedTotal !== null && rows.length >= expectedTotal)
    ) {
      return {
        readable: true,
        complete: true,
        pages: page,
        rows,
        error: null,
      };
    }
  }
  return {
    readable: true,
    complete: false,
    pages: 100,
    rows,
    error: "check-runs exceeded pagination safety limit",
  };
}

try {
  const query = `
    query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        branchProtectionRules(first: 100) {
          pageInfo { hasNextPage }
          nodes { pattern }
        }
        pullRequest(number: $number) {
          url
          baseRefName
          headRefOid
          mergeStateStatus
        }
      }
    }`;
  const graph = ghJson([
    "api",
    "graphql",
    "-f",
    `query=${query}`,
    "-F",
    `owner=${owner}`,
    "-F",
    `name=${name}`,
    "-F",
    `number=${pr}`,
  ]);
  if (graph.errors?.length) throw new Error(JSON.stringify(graph.errors));

  const repository = graph.data?.repository;
  const pullRequest = repository?.pullRequest;
  if (!pullRequest) throw new Error("PR not found");

  const base = pullRequest.baseRefName;
  const sha = pullRequest.headRefOid;
  const branchRules = repository.branchProtectionRules || {};
  const matchingClassicRules = (branchRules.nodes || []).filter((rule) =>
    patternMatchesBranch(rule.pattern, base),
  );

  let classicRequiredStatusChecks = null;
  let classicProtectionReadable = false;
  let classicProtectionError = null;
  const classicResponse = ghOk([
    "api",
    `repos/${owner}/${name}/branches/${encodeURIComponent(base)}/protection`,
  ]);
  if (classicResponse.ok) {
    try {
      const payload = JSON.parse(classicResponse.stdout);
      classicRequiredStatusChecks = payload.required_status_checks || null;
      classicProtectionReadable = true;
    } catch {
      classicProtectionError = "classic protection returned invalid JSON";
    }
  } else {
    classicProtectionError =
      (classicResponse.stderr || classicResponse.stdout || "").trim() || null;
  }

  const activeRulesFetch = fetchPagedArray(
    `repos/${owner}/${name}/rules/branches/${encodeURIComponent(base)}`,
    "active rules",
  );
  const checkRunsFetch = fetchCheckRuns(sha);
  const statusesFetch = fetchPagedArray(
    `repos/${owner}/${name}/commits/${sha}/statuses`,
    "commit statuses",
  );

  const normalizedPolicy = normalizeRequiredChecks({
    classicRequiredStatusChecks,
    activeRules: activeRulesFetch.rows,
  });
  const completeness = evaluateRequiredCheckCompleteness({
    branchProtectionGraphqlComplete:
      branchRules.pageInfo?.hasNextPage !== true,
    matchingClassicRuleCount: matchingClassicRules.length,
    classicProtectionReadable,
    activeRulesComplete: activeRulesFetch.complete,
    checkRunsComplete: checkRunsFetch.complete,
    statusesComplete: statusesFetch.complete,
  });
  const evaluation = evaluateRequiredChecks({
    descriptors: normalizedPolicy.descriptors,
    checkRuns: checkRunsFetch.rows,
    statuses: statusesFetch.rows,
    evidenceComplete: completeness.complete,
    incompleteReasons: completeness.reasons,
    strict: normalizedPolicy.strict,
    mergeStateStatus: pullRequest.mergeStateStatus,
  });

  const output = {
    schemaVersion: 1,
    repo,
    pr,
    url: pullRequest.url,
    base,
    sha,
    strict: normalizedPolicy.strict,
    mergeStateStatus: pullRequest.mergeStateStatus,
    complete: evaluation.complete,
    decision: evaluation.decision,
    ready: evaluation.ready,
    blocked: evaluation.blocked,
    unknown: evaluation.unknown,
    mode: evaluation.mode,
    blockers: evaluation.blockers,
    unknowns: evaluation.unknowns,
    requiredChecks: normalizedPolicy.descriptors,
    requiredStatus: evaluation.requiredStatus,
    observedStatus: evaluation.observedStatus,
    allLive: evaluation.allLive,
    sources: {
      branchProtectionGraphqlComplete:
        branchRules.pageInfo?.hasNextPage !== true,
      matchingClassicRuleCount: matchingClassicRules.length,
      classicProtectionReadable,
      classicProtectionError,
      activeRulesReadable: activeRulesFetch.readable,
      activeRulesComplete: activeRulesFetch.complete,
      activeRulesPages: activeRulesFetch.pages,
      activeRulesError: activeRulesFetch.error,
      checkRunsReadable: checkRunsFetch.readable,
      checkRunsComplete: checkRunsFetch.complete,
      checkRunsPages: checkRunsFetch.pages,
      checkRunsError: checkRunsFetch.error,
      statusesReadable: statusesFetch.readable,
      statusesComplete: statusesFetch.complete,
      statusesPages: statusesFetch.pages,
      statusesError: statusesFetch.error,
    },
    note:
      evaluation.mode === "configured"
        ? "Configured required checks preserve app identity where GitHub provides app_id/integration_id."
        : "No configured required list was found; visible live checks are evaluated without inventing check names.",
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exitCode = output.ready ? 0 : output.blocked ? 1 : 2;
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
