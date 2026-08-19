import { ownersForPath, parseCodeowners } from "./codeowners.mjs";
import {
  evaluateRequiredCheckCompleteness,
  evaluateRequiredChecks,
  normalizeRequiredChecks,
} from "./required-checks-policy.mjs";
import {
  evaluatePolicyDataCompleteness,
  evaluateReviewPolicy,
  maxRequiredApprovalCount,
} from "./review-policy.mjs";
import {
  evaluateFeedbackResolutions,
  normalizeFeedback,
} from "./watch-feedback.mjs";
import { formatAddressedFeedbackComment } from "./addressed-feedback-comment.mjs";
import { planAddressedFeedbackPublication } from "./addressed-feedback-dedup.mjs";

const DIRTY_STATES = new Set(["DIRTY", "CONFLICTING", "BEHIND"]);

function source(snapshot, name) {
  return snapshot?.sources?.[name] || {};
}

function sourceComplete(snapshot, name) {
  return source(snapshot, name).complete === true;
}

function sourceReadable(snapshot, name) {
  return source(snapshot, name).readable === true;
}

function escapeRegexCharacter(value) {
  return /[\\^$.*+?()[\]{}|]/.test(value) ? `\\${value}` : value;
}

function characterClassExpression(source) {
  if (!source) return null;
  let value = source;
  let prefix = "";
  if (value[0] === "!" || value[0] === "^") {
    prefix = "^";
    value = value.slice(1);
  }
  if (!value) return null;
  const escaped = value
    .replaceAll("\\", "\\\\")
    .replaceAll("]", "\\]");
  return `[${prefix}${escaped}]`;
}

export function patternMatchesBranch(pattern, branch) {
  const source = String(pattern || "");
  const target = String(branch || "");
  if (!source) return false;
  if (source === target) return true;

  let expression = "^";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\" && index + 1 < source.length) {
      expression += escapeRegexCharacter(source[++index]);
      continue;
    }
    if (character === "*") {
      if (source[index + 1] === "*") {
        while (source[index + 1] === "*") index += 1;
        expression += ".*";
      } else {
        expression += "[^/]*";
      }
      continue;
    }
    if (character === "?") {
      expression += "[^/]";
      continue;
    }
    if (character === "[") {
      const close = source.indexOf("]", index + 1);
      if (close > index + 1) {
        const classExpression = characterClassExpression(source.slice(index + 1, close));
        if (classExpression) {
          expression += classExpression;
          index = close;
          continue;
        }
      }
    }
    expression += escapeRegexCharacter(character);
  }
  expression += "$";

  try {
    return new RegExp(expression).test(target);
  } catch {
    return false;
  }
}

function policyEvidence(snapshot) {
  return snapshot?.evidence?.policy || {};
}

function pullRequest(snapshot) {
  return snapshot?.evidence?.pullRequest || {};
}

function matchingClassicRules(snapshot) {
  const base = pullRequest(snapshot).baseRefName;
  return (
    policyEvidence(snapshot).branchProtectionRules?.nodes || []
  ).filter((rule) => patternMatchesBranch(rule?.pattern, base));
}

function classicProtectionReadable(snapshot, matchingRules) {
  if (!sourceReadable(snapshot, "branchProtection")) return false;
  if (!matchingRules.length) return true;
  return snapshot?.evidence?.branchProtection !== null &&
    snapshot?.evidence?.branchProtection !== undefined;
}

function activePullRequestRules(snapshot) {
  return (snapshot?.evidence?.activeRules || [])
    .filter((rule) => rule?.type === "pull_request" && rule.parameters)
    .map((rule) => ({
      require_code_owner_review:
        rule.parameters.require_code_owner_review ?? null,
      dismiss_stale_reviews_on_push:
        rule.parameters.dismiss_stale_reviews_on_push ?? null,
      require_last_push_approval:
        rule.parameters.require_last_push_approval ?? null,
      required_approving_review_count:
        rule.parameters.required_approving_review_count ?? null,
      required_review_thread_resolution:
        rule.parameters.required_review_thread_resolution ?? null,
      ruleset_source_type: rule.ruleset_source_type ?? null,
      ruleset_source: rule.ruleset_source ?? null,
      ruleset_id: rule.ruleset_id ?? null,
    }));
}

function restReviewProtection(snapshot) {
  const reviews = snapshot?.evidence?.branchProtection?.required_pull_request_reviews;
  if (reviews === undefined) return null;
  return {
    requiresApprovingReviews: reviews !== null,
    requiresCodeOwnerReviews: reviews?.require_code_owner_reviews ?? null,
    dismissesStaleReviews: reviews?.dismiss_stale_reviews ?? null,
    requireLastPushApproval: reviews?.require_last_push_approval ?? null,
    requiredApprovingReviewCount:
      reviews?.required_approving_review_count ?? null,
  };
}

function decisionFrom(blockers, unknowns) {
  if (blockers.length) return "blocked";
  if (unknowns.length) return "unknown";
  return "ready";
}

export function evaluateRequiredChecksSnapshot(snapshot) {
  const pr = pullRequest(snapshot);
  const base = pr.baseRefName;
  const branchRules = policyEvidence(snapshot).branchProtectionRules || {};
  const matchingRules = matchingClassicRules(snapshot);
  const classicRequiredStatusChecks =
    snapshot?.evidence?.branchProtection?.required_status_checks || null;
  const activeRules = snapshot?.evidence?.activeRules || [];
  const checkRuns = snapshot?.evidence?.checks?.checkRuns || [];
  const statuses = snapshot?.evidence?.checks?.statuses || [];

  const normalizedPolicy = normalizeRequiredChecks({
    classicRequiredStatusChecks,
    activeRules,
  });
  const completeness = evaluateRequiredCheckCompleteness({
    branchProtectionGraphqlComplete:
      sourceComplete(snapshot, "policyGraphql") &&
      branchRules.pageInfo?.hasNextPage !== true,
    matchingClassicRuleCount: matchingRules.length,
    classicProtectionReadable: classicProtectionReadable(snapshot, matchingRules),
    activeRulesComplete: sourceComplete(snapshot, "activeRules"),
    checkRunsComplete: sourceComplete(snapshot, "checkRuns"),
    statusesComplete: sourceComplete(snapshot, "statuses"),
  });
  const evaluation = evaluateRequiredChecks({
    descriptors: normalizedPolicy.descriptors,
    checkRuns,
    statuses,
    evidenceComplete: completeness.complete,
    incompleteReasons: completeness.reasons,
    strict: normalizedPolicy.strict,
    mergeStateStatus: pr.mergeStateStatus,
  });

  return {
    schemaVersion: 1,
    snapshotId: snapshot.snapshotId,
    repo: snapshot.repo,
    pr: snapshot.pr,
    url: pr.url,
    base,
    sha: snapshot.headOid,
    strict: normalizedPolicy.strict,
    mergeStateStatus: pr.mergeStateStatus,
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
  };
}

export function evaluateReviewPolicySnapshot(snapshot) {
  const pr = pullRequest(snapshot);
  const branchRules = policyEvidence(snapshot).branchProtectionRules || {};
  const matchingRules = matchingClassicRules(snapshot);
  const restProtection = restReviewProtection(snapshot);
  const pullRequestRules = activePullRequestRules(snapshot);

  const requiredApprovalCount = maxRequiredApprovalCount({
    restProtection,
    activePullRequestRules: pullRequestRules,
  });
  const requiresCodeOwnerReviews = Boolean(
    restProtection?.requiresCodeOwnerReviews ||
      pullRequestRules.some((rule) => rule.require_code_owner_review === true),
  );
  const dismissesStaleReviews = Boolean(
    restProtection?.dismissesStaleReviews ||
      pullRequestRules.some(
        (rule) => rule.dismiss_stale_reviews_on_push === true,
      ),
  );
  const requireLastPushApproval = Boolean(
    restProtection?.requireLastPushApproval ||
      pullRequestRules.some(
        (rule) => rule.require_last_push_approval === true,
      ),
  );
  const requiresConversationResolution = Boolean(
    pullRequestRules.some(
      (rule) => rule.required_review_thread_resolution === true,
    ),
  );
  const requiresApprovingReviews = Boolean(
    restProtection?.requiresApprovingReviews ||
      requiredApprovalCount > 0 ||
      requiresCodeOwnerReviews ||
      requireLastPushApproval,
  );

  const latestReviews =
    policyEvidence(snapshot).latestOpinionatedReviews?.nodes || [];
  const evaluation = evaluateReviewPolicy({
    isDraft: pr.isDraft,
    reviewDecision: pr.reviewDecision,
    requiresApprovingReviews,
    requiresCodeOwnerReviews,
    requireLastPushApproval,
    requiresConversationResolution,
    requiredApprovalCount,
    latestOpinionatedReviews: latestReviews,
  });
  const completeness = evaluatePolicyDataCompleteness({
    branchProtectionGraphqlComplete:
      sourceComplete(snapshot, "policyGraphql") &&
      branchRules.pageInfo?.hasNextPage !== true,
    matchingClassicRuleCount: matchingRules.length,
    classicProtectionReadable: classicProtectionReadable(snapshot, matchingRules),
    activeRulesComplete: sourceComplete(snapshot, "activeRules"),
  });

  const blockers = [...evaluation.blockers];
  const mergeQueue = policyEvidence(snapshot).mergeQueue || {
    enabled: false,
    inQueue: false,
    entry: null,
  };
  if (mergeQueue.inQueue && pr.mergeStateStatus !== "CLEAN") {
    blockers.push("merge_queue_not_merged");
  }
  const unknowns = completeness.complete ? [] : [...completeness.reasons];
  const uniqueBlockers = [...new Set(blockers)];
  const uniqueUnknowns = [...new Set(unknowns)];
  const decision = decisionFrom(uniqueBlockers, uniqueUnknowns);

  return {
    schemaVersion: 1,
    snapshotId: snapshot.snapshotId,
    repo: snapshot.repo,
    pr: snapshot.pr,
    base: pr.baseRefName,
    headOid: snapshot.headOid,
    url: pr.url,
    complete: uniqueUnknowns.length === 0,
    decision,
    blockers: uniqueBlockers,
    unknowns: uniqueUnknowns,
    mergeStateStatus: pr.mergeStateStatus,
    mergeQueue,
    mergeGroupWorkflowCoverage: snapshot?.evidence?.workflowCoverage || null,
    reviewPolicy: {
      matchingBranchProtectionPatterns: matchingRules.map((rule) => rule.pattern),
      requiresApprovingReviews,
      requiredApprovalCount,
      requiresCodeOwnerReviews,
      dismissesStaleReviews,
      requireLastPushApproval,
      requiresConversationResolution,
      requiredFollowUpChecks: requiresConversationResolution
        ? ["review-threads"]
        : [],
      restProtection,
      activePullRequestRules: pullRequestRules,
    },
    approvals: {
      reviewDecision: pr.reviewDecision,
      effective: evaluation.approvals.map((review) => review.author?.login),
      changesRequested: evaluation.changesRequested.map(
        (review) => review.author?.login,
      ),
    },
  };
}

export function evaluateReviewThreadsSnapshot(snapshot) {
  const pr = pullRequest(snapshot);
  const threads = snapshot?.evidence?.feedback?.reviewThreads || [];
  const complete = sourceComplete(snapshot, "reviewThreads");
  const unresolved = threads.filter((thread) => thread?.isResolved === false);
  const useful = unresolved.map((thread) => {
    const comments = thread.comments?.nodes || [];
    const first = comments[0];
    const last = comments[comments.length - 1];
    return {
      threadId: thread.id,
      path: thread.path,
      line: thread.line,
      isOutdated: thread.isOutdated,
      author: first?.author?.login || null,
      preview: String(first?.body || "").slice(0, 240),
      commentCount: comments.length,
      lastAuthor: last?.author?.login || null,
    };
  });
  const blockers = unresolved.length ? ["unresolved_review_threads"] : [];
  const unknowns = complete ? [] : ["review_threads_incomplete"];
  const decision = decisionFrom(blockers, unknowns);
  return {
    schemaVersion: 1,
    snapshotId: snapshot.snapshotId,
    repo: snapshot.repo,
    pr: snapshot.pr,
    url: pr.url,
    reviewDecision: pr.reviewDecision || null,
    complete,
    decision,
    blockers,
    unknowns,
    totalThreads: threads.length,
    unresolvedCount: unresolved.length,
    unresolved: useful,
  };
}

export function evaluateCodeownersSnapshot(snapshot) {
  const pr = pullRequest(snapshot);
  const changedFiles = snapshot?.evidence?.changedFiles || [];
  const codeowners = snapshot?.evidence?.codeowners || {};
  const rules = codeowners.text ? parseCodeowners(codeowners.text) : [];
  const files = {};
  const ownersUnion = new Set();
  for (const row of changedFiles) {
    const path = row?.filename;
    if (!path) continue;
    const match = ownersForPath(rules, path);
    files[path] = match;
    for (const owner of match?.owners || []) ownersUnion.add(owner);
  }
  const complete =
    sourceComplete(snapshot, "changedFiles") &&
    sourceComplete(snapshot, "codeowners");
  return {
    schemaVersion: 1,
    snapshotId: snapshot.snapshotId,
    repo: snapshot.repo,
    pr: snapshot.pr,
    base: pr.baseRefName,
    headOid: snapshot.headOid,
    url: pr.url,
    complete,
    decision: complete ? "ready" : "unknown",
    authority: "advisory",
    authorityNote:
      "GitHub reviewDecision remains authoritative for enforced CODEOWNERS approval.",
    codeownersPath: codeowners.path || null,
    codeownersErrors: codeowners.errors || [],
    changedFiles: Object.keys(files).length,
    ownersUnion: [...ownersUnion],
    reviewRequests: (pr.reviewRequests || [])
      .map((request) => request?.login || request?.slug || request?.name || null)
      .filter(Boolean),
    reviewDecision: pr.reviewDecision || null,
    files,
    unknowns: complete ? [] : ["codeowners_evidence_incomplete"],
  };
}

function normalizedCommits(snapshot) {
  return (pullRequest(snapshot).commits || []).map((commit) => ({
    oid: commit.oid || commit.commit?.oid,
    message: String(
      commit.messageHeadline || commit.commit?.messageHeadline || commit.message || "",
    ).trim(),
    authoredDate:
      commit.committedDate ||
      commit.commit?.authoredDate ||
      commit.authoredDate ||
      null,
  }));
}

export function evaluateWakeSnapshot(snapshot) {
  const pr = pullRequest(snapshot);
  const feedbackEvidence = snapshot?.evidence?.feedback || {};
  const feedback = [
    ...(feedbackEvidence.issueComments || []).map((row) =>
      normalizeFeedback(row, "issue_comment"),
    ),
    ...(feedbackEvidence.reviewComments || []).map((row) =>
      normalizeFeedback(row, "review_comment"),
    ),
    ...(feedbackEvidence.reviews || []).map((row) =>
      normalizeFeedback(row, "review_submission"),
    ),
  ];
  const commits = normalizedCommits(snapshot);
  const myLogin = snapshot?.evidence?.viewer?.login || null;
  const resolution = evaluateFeedbackResolutions({ feedback, commits, myLogin, headOid: snapshot.headOid });
  const unaddressed = resolution.unaddressed;
  const blockers = [];
  if (
    DIRTY_STATES.has(pr.mergeStateStatus || "") ||
    pr.mergeable === "CONFLICTING"
  ) {
    blockers.push({
      key: "base-state",
      kind: "merge_state",
      url: pr.url,
      reason: "base_dirty_or_behind",
      excerpt: `mergeStateStatus=${pr.mergeStateStatus || ""} mergeable=${pr.mergeable || ""}`,
    });
  }
  const addressedFeedbackComment = unaddressed.length
    ? formatAddressedFeedbackComment({
        feedbackKeys: unaddressed.map((comment) => comment.key),
        commitRef: "<7-40 character PR commit SHA>",
        headOid: snapshot.headOid,
      })
    : null;
  const addressedFeedbackPlan = planAddressedFeedbackPublication({
    comments: feedbackEvidence.issueComments || [],
    myLogin,
    headOid: snapshot.headOid,
  });
  for (const comment of unaddressed) {
    blockers.push({
      key: comment.key,
      id: comment.id,
      kind: comment.kind,
      author: comment.login,
      association: comment.association,
      createdAt: comment.createdAt,
      url: comment.url,
      path: comment.path,
      line: comment.line,
      excerpt: comment.body.replace(/\s+/g, " ").slice(0, 220),
      reason: "trusted_human_feedback_needs_code",
      howToClear: addressedFeedbackComment,
    });
  }
  const complete = [
    "issueComments",
    "reviewComments",
    "reviews",
    "viewer",
  ].every((name) => sourceComplete(snapshot, name));
  const unknowns = complete ? [] : ["feedback_data_incomplete"];
  const decision = decisionFrom(
    blockers.map((blocker) => blocker.reason),
    unknowns,
  );
  return {
    schemaVersion: 1,
    snapshotId: snapshot.snapshotId,
    repo: snapshot.repo,
    pr: snapshot.pr,
    url: pr.url,
    headRefOid: snapshot.headOid,
    mergeStateStatus: pr.mergeStateStatus,
    mergeable: pr.mergeable,
    complete,
    decision,
    canWait: decision === "ready",
    blockerCount: blockers.length,
    blockers,
    unknowns,
    feedbackCount: feedback.length,
    addressedFeedbackKeys: resolution.addressedKeys,
    resolutionRecords: resolution.validRecords,
    resolutionDiagnostics: resolution.diagnostics,
    addressedFeedbackComment,
    addressedFeedbackPlan,
  };
}
