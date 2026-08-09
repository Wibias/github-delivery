import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

import { classifyAuthority } from "./authority-grant.mjs";
import { acquireAutonomousIdempotencyClaim } from "./autonomous-idempotency-claim.mjs";
import { authorizeMutation } from "./mutation-policy.mjs";
import { evaluateHeadBranchCleanup } from "./merge-branch-cleanup.mjs";
import { classifyMergeOutcome, readMergeState } from "./merge-outcome.mjs";

const PR_ACTIONS = new Set([
  "post_review",
  "post_comment",
  "edit_own_comment",
  "reply_bot_thread",
  "reply_human_thread",
  "resolve_thread",
  "resolve_bot_thread",
  "change_draft_state",
  "request_reviewers",
  "close_pr",
  "supersede_pr",
  "merge_pr",
  "retarget_pr",
  "post_resolution_record",
]);

const SOCIAL_ACTIONS = new Set([
  "post_review",
  "post_comment",
  "post_issue_comment",
  "edit_own_comment",
  "reply_bot_thread",
  "reply_human_thread",
  "supersede_pr",
  "create_follow_up_issue",
  "post_resolution_record",
]);

const REMOTE_IDEMPOTENT_CREATE_ACTIONS = new Set([
  "post_review",
  "post_comment",
  "post_issue_comment",
  "reply_bot_thread",
  "reply_human_thread",
  "create_follow_up_issue",
  "post_resolution_record",
]);

const REVIEW_THREAD_ACTIONS = new Set(["resolve_thread", "resolve_bot_thread"]);
const CLEANUP_ACTIONS = new Set(["delete_head_branch"]);
const IDEMPOTENCY_MARKER_RE = /\n\n<!-- github-delivery:idempotency [0-9a-f]{64} -->\s*$/i;
const BOT_LOGIN_RE = /\[bot\]$/i;

function sha256(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function required(value, name) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`${name}_required`);
  }
  return value;
}

export function idempotencyMarker(key) {
  return `<!-- github-delivery:idempotency ${sha256(required(key, "idempotency_key"))} -->`;
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${name}_invalid`);
  }
  return number;
}

function repoParts(repo) {
  const parts = String(repo || "").split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("repo_invalid");
  }
  return { owner: parts[0], name: parts[1] };
}

function branchRefPath(branch) {
  return String(branch)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function visibleBody(value) {
  return String(value ?? "").replace(IDEMPOTENCY_MARKER_RE, "");
}

function bodyWithIdempotencyMarker(body, marker) {
  const clean = visibleBody(required(body, "body")).trimEnd();
  return `${clean}\n\n${marker}`;
}

function commandFor(request) {
  const repo = required(request.repo, "repo");
  switch (request.action) {
    case "merge_pr": {
      const method =
        request.mergeMethod === "squash"
          ? "--squash"
          : request.mergeMethod === "rebase"
            ? "--rebase"
            : "--merge";
      return [
        "gh",
        "pr",
        "merge",
        String(positiveInteger(request.pr, "pr")),
        "--repo",
        repo,
        method,
        "--match-head-commit",
        required(request.expectedHead, "expected_head"),
      ];
    }
    case "retarget_pr": {
      const { owner, name } = repoParts(repo);
      return [
        "gh",
        "api",
        `repos/${owner}/${name}/pulls/${positiveInteger(request.pr, "pr")}`,
        "--method",
        "PATCH",
        "-f",
        `base=${required(request.newBase, "new_base")}`,
      ];
    }
    case "post_comment":
    case "post_resolution_record":
      return [
        "gh",
        "pr",
        "comment",
        String(positiveInteger(request.pr, "pr")),
        "--repo",
        repo,
        "--body",
        required(request.body, "body"),
      ];
    case "post_issue_comment":
      return [
        "gh",
        "issue",
        "comment",
        String(positiveInteger(request.issue, "issue")),
        "--repo",
        repo,
        "--body",
        required(request.body, "body"),
      ];
    case "post_review":
      return [
        "gh",
        "pr",
        "review",
        String(positiveInteger(request.pr, "pr")),
        "--repo",
        repo,
        "--comment",
        "--body",
        required(request.body, "body"),
      ];
    case "edit_own_comment": {
      const { owner, name } = repoParts(repo);
      return [
        "gh",
        "api",
        `repos/${owner}/${name}/issues/comments/${positiveInteger(request.commentId, "comment_id")}`,
        "--method",
        "PATCH",
        "-f",
        `body=${required(request.body, "body")}`,
      ];
    }
    case "reply_bot_thread":
    case "reply_human_thread": {
      const { owner, name } = repoParts(repo);
      return [
        "gh",
        "api",
        `repos/${owner}/${name}/pulls/${positiveInteger(request.pr, "pr")}/comments/${positiveInteger(request.commentId, "comment_id")}/replies`,
        "--method",
        "POST",
        "-f",
        `body=${required(request.body, "body")}`,
      ];
    }
    case "resolve_thread":
    case "resolve_bot_thread":
      return [
        "gh",
        "api",
        "graphql",
        "-f",
        "query=mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{id isResolved}}}",
        "-F",
        `id=${required(request.threadId, "thread_id")}`,
      ];
    case "change_draft_state":
      return request.ready === false
        ? [
            "gh",
            "pr",
            "ready",
            String(positiveInteger(request.pr, "pr")),
            "--repo",
            repo,
            "--undo",
          ]
        : [
            "gh",
            "pr",
            "ready",
            String(positiveInteger(request.pr, "pr")),
            "--repo",
            repo,
          ];
    case "request_reviewers": {
      const reviewers = Array.isArray(request.reviewers)
        ? request.reviewers.filter(Boolean)
        : [];
      if (!reviewers.length) throw new Error("reviewers_required");
      const command = [
        "gh",
        "pr",
        "edit",
        String(positiveInteger(request.pr, "pr")),
        "--repo",
        repo,
      ];
      for (const reviewer of reviewers) {
        command.push("--add-reviewer", reviewer);
      }
      return command;
    }
    case "close_pr":
      return [
        "gh",
        "pr",
        "close",
        String(positiveInteger(request.pr, "pr")),
        "--repo",
        repo,
      ];
    case "supersede_pr": {
      const command = [
        "gh",
        "pr",
        "close",
        String(positiveInteger(request.pr, "pr")),
        "--repo",
        repo,
      ];
      let body;
      if (request.body) {
        body = required(request.body, "body");
      } else if (request.supersedingPr) {
        body = `Superseded by PR #${positiveInteger(request.supersedingPr, "superseding_pr")}.`;
      } else {
        throw new Error("body_or_superseding_pr_required");
      }
      command.push("--comment", body);
      return command;
    }
    case "close_linked_issue":
      return [
        "gh",
        "issue",
        "close",
        String(positiveInteger(request.issue, "issue")),
        "--repo",
        repo,
      ];
    case "create_follow_up_issue":
      return [
        "gh",
        "issue",
        "create",
        "--repo",
        repo,
        "--title",
        required(request.title, "title"),
        "--body",
        required(request.body, "body"),
      ];
    case "delete_head_branch": {
      const targetRepo = required(request.targetRepo || request.repo, "target_repo");
      const { owner, name } = repoParts(targetRepo);
      const branch = required(request.headRefName, "head_ref_name");
      return [
        "gh",
        "api",
        "-X",
        "DELETE",
        `repos/${owner}/${name}/git/refs/heads/${branchRefPath(branch)}`,
      ];
    }
    default:
      throw new Error(`unsupported_action:${request.action}`);
  }
}

function runOrThrow(runner, command) {
  const [executable, ...args] = command;
  const result = runner(executable, args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new Error(detail || `mutation_command_failed:${result.status}`);
  }
  return String(result.stdout || "").trim();
}

function parseJson(output, errorCode) {
  try {
    const value = JSON.parse(output);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("not_object");
    }
    return value;
  } catch {
    throw new Error(errorCode);
  }
}

function parseSlurpedCollection(output) {
  let payload;
  try {
    payload = JSON.parse(output || "[]");
  } catch {
    throw new Error("idempotency_lookup_invalid_json");
  }
  if (!Array.isArray(payload)) throw new Error("idempotency_lookup_invalid_payload");
  return payload.flatMap((page) => {
    if (Array.isArray(page)) return page;
    return page && typeof page === "object" ? [page] : [];
  });
}

function verifyHead({ request, runner }) {
  if (!PR_ACTIONS.has(request.action)) return null;
  const expectedHead = required(request.expectedHead, "expected_head");
  const output = runOrThrow(runner, [
    "gh",
    "pr",
    "view",
    String(positiveInteger(request.pr, "pr")),
    "--repo",
    required(request.repo, "repo"),
    "--json",
    "headRefOid",
    "--jq",
    ".headRefOid",
  ]);
  if (output !== expectedHead) {
    throw new Error(
      `expected_head_mismatch: expected ${expectedHead}, observed ${output || "missing"}`,
    );
  }
  return output;
}

function verifyReviewThreadTarget({ request, runner }) {
  if (!REVIEW_THREAD_ACTIONS.has(request.action)) return null;
  const threadId = required(request.threadId, "thread_id");
  const query = `query($id:ID!){node(id:$id){... on PullRequestReviewThread{id isResolved repository{nameWithOwner} pullRequest{number headRefOid} comments(first:1){nodes{author{login}}}}}}`;
  const payload = parseJson(
    runOrThrow(runner, [
      "gh",
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-F",
      `id=${threadId}`,
    ]),
    "review_thread_evidence_invalid",
  );
  if (payload.errors?.length) {
    throw new Error(`review_thread_evidence_error:${JSON.stringify(payload.errors)}`);
  }
  const thread = payload.data?.node;
  if (!thread || thread.id !== threadId) {
    throw new Error("review_thread_target_missing");
  }
  const repo = required(thread.repository?.nameWithOwner, "review_thread_repo");
  if (String(repo).toLowerCase() !== String(request.repo).toLowerCase()) {
    throw new Error("review_thread_target_mismatch:repo");
  }
  const pr = positiveInteger(thread.pullRequest?.number, "review_thread_pr");
  if (pr !== positiveInteger(request.pr, "pr")) {
    throw new Error("review_thread_target_mismatch:pr");
  }
  const head = required(thread.pullRequest?.headRefOid, "review_thread_head");
  if (String(head).toLowerCase() !== String(request.expectedHead).toLowerCase()) {
    throw new Error("review_thread_target_mismatch:head");
  }
  const author = thread.comments?.nodes?.[0]?.author?.login || null;
  if (request.action === "resolve_bot_thread" && !BOT_LOGIN_RE.test(String(author || ""))) {
    throw new Error("resolve_bot_thread_target_not_bot");
  }
  return {
    threadId,
    repo,
    pr,
    expectedHead: head,
    author,
    isResolved: thread.isResolved === true,
  };
}

function verifyRetargetBase({ request, runner }) {
  if (request.action !== "retarget_pr") return null;
  const expectedBase = required(request.expectedBase, "expected_base");
  const newBase = required(request.newBase, "new_base");
  const observedBase = runOrThrow(runner, [
    "gh",
    "pr",
    "view",
    String(positiveInteger(request.pr, "pr")),
    "--repo",
    required(request.repo, "repo"),
    "--json",
    "baseRefName",
    "--jq",
    ".baseRefName",
  ]);
  if (observedBase === newBase) {
    return { observedBase, alreadyApplied: true };
  }
  if (observedBase !== expectedBase) {
    throw new Error(
      `expected_base_mismatch: expected ${expectedBase}, observed ${observedBase || "missing"}`,
    );
  }
  return { observedBase, alreadyApplied: false };
}

function verifyOwnCommentTarget({ request, runner }) {
  if (request.action !== "edit_own_comment") return null;
  const repo = required(request.repo, "repo");
  const { owner, name } = repoParts(repo);
  const pr = positiveInteger(request.pr, "pr");
  const commentId = positiveInteger(request.commentId, "comment_id");

  const viewer = parseJson(
    runOrThrow(runner, ["gh", "api", "user"]),
    "viewer_evidence_invalid",
  );
  const actorLogin = required(viewer.login, "viewer_login");
  const comment = parseJson(
    runOrThrow(runner, [
      "gh",
      "api",
      `repos/${owner}/${name}/issues/comments/${commentId}`,
    ]),
    "comment_evidence_invalid",
  );
  const commentLogin = required(comment.user?.login, "comment_author_login");
  if (String(commentLogin).toLowerCase() !== String(actorLogin).toLowerCase()) {
    throw new Error("comment_not_owned_by_actor");
  }

  const issueUrl = required(comment.issue_url, "comment_issue_url");
  const expectedSuffix = `/repos/${owner}/${name}/issues/${pr}`.toLowerCase();
  if (!String(issueUrl).toLowerCase().endsWith(expectedSuffix)) {
    throw new Error("comment_target_mismatch");
  }

  return { actorLogin, commentId, issueUrl };
}

function idempotencyLookupPath(request) {
  if (!REMOTE_IDEMPOTENT_CREATE_ACTIONS.has(request.action)) return null;
  const { owner, name } = repoParts(required(request.repo, "repo"));
  switch (request.action) {
    case "post_comment":
    case "post_resolution_record":
      return `repos/${owner}/${name}/issues/${positiveInteger(request.pr, "pr")}/comments?per_page=100`;
    case "post_issue_comment":
      return `repos/${owner}/${name}/issues/${positiveInteger(request.issue, "issue")}/comments?per_page=100`;
    case "post_review":
      return `repos/${owner}/${name}/pulls/${positiveInteger(request.pr, "pr")}/reviews?per_page=100`;
    case "reply_bot_thread":
    case "reply_human_thread":
      return `repos/${owner}/${name}/pulls/${positiveInteger(request.pr, "pr")}/comments?per_page=100`;
    case "create_follow_up_issue":
      return `repos/${owner}/${name}/issues?state=all&per_page=100`;
    default:
      return null;
  }
}

function findExistingIdempotentMutation({ request, runner }) {
  const path = idempotencyLookupPath(request);
  if (!path) return null;
  const marker = required(request.idempotencyMarker, "idempotency_marker");
  const output = runOrThrow(runner, ["gh", "api", path, "--paginate", "--slurp"]);
  const records = parseSlurpedCollection(output);
  const existing = records.find((record) => String(record?.body || "").includes(marker));
  if (!existing) return null;
  return {
    id: existing.id ?? existing.number ?? null,
    number: existing.number ?? null,
    url: existing.html_url || existing.url || null,
  };
}

function verifyBranchDeleted({ request, runner }) {
  if (request.action !== "delete_head_branch") return null;
  const targetRepo = required(request.targetRepo || request.repo, "target_repo");
  const { owner, name } = repoParts(targetRepo);
  const branch = required(request.headRefName, "head_ref_name");
  const result = runner(
    "gh",
    ["api", `repos/${owner}/${name}/git/ref/heads/${branchRefPath(branch)}`],
    {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  if (result.status === 0) {
    throw new Error("branch_still_exists");
  }
  const detail = String(result.stderr || result.stdout || "").toLowerCase();
  const confirmedNotFound = detail.includes("404") || detail.includes("not found");
  if (!confirmedNotFound) {
    throw new Error(`branch_delete_verification_failed:${result.status}`);
  }
  return "deleted";
}

function verificationCommand(request) {
  switch (request.action) {
    case "merge_pr":
      return null;
    case "retarget_pr":
      return [
        "gh",
        "pr",
        "view",
        String(request.pr),
        "--repo",
        request.repo,
        "--json",
        "baseRefName",
        "--jq",
        ".baseRefName",
      ];
    case "close_pr":
    case "supersede_pr":
      return [
        "gh",
        "pr",
        "view",
        String(request.pr),
        "--repo",
        request.repo,
        "--json",
        "state,closedAt",
      ];
    case "close_linked_issue":
      return [
        "gh",
        "issue",
        "view",
        String(request.issue),
        "--repo",
        request.repo,
        "--json",
        "state",
      ];
    case "change_draft_state":
      return [
        "gh",
        "pr",
        "view",
        String(request.pr),
        "--repo",
        request.repo,
        "--json",
        "isDraft,headRefOid",
      ];
    case "delete_head_branch":
      return null;
    default:
      return null;
  }
}

function assertDeleteHeadBranchAllowed(request) {
  const decision = evaluateHeadBranchCleanup({
    actorLogin: request.actorLogin,
    headOwnerLogin: request.headOwnerLogin,
    headRefName: request.headRefName,
    isMerged:
      request.isMerged === true ||
      String(request.state || request.prState || "").toUpperCase() === "MERGED",
    isCrossRepository: request.isCrossRepository === true,
    targetRepo: request.targetRepo,
    headRepository: request.headRepository,
    headRepo: request.headRepo,
    baseRepository: request.baseRepository,
    baseRepo: request.baseRepo || request.repo,
    keepBranch: request.keepBranch === true,
  });
  if (decision.action !== "delete") {
    throw new Error(`branch_cleanup_denied:${decision.reason}`);
  }
  return decision;
}

function publicAuthorityReceipt(authority) {
  return authority.verified
    ? {
        provenance: authority.provenance,
        verified: true,
        reason: null,
        claims: structuredClone(authority.claims),
      }
    : {
        provenance: authority.provenance,
        verified: false,
        reason: authority.reason,
      };
}

export function planMutationRequest(
  request = {},
  {
    authorityPublicKey = null,
    requireTrustedAuthority = false,
    authorityNow,
    authorityMaxTtlSeconds,
    authorityClockSkewSeconds,
  } = {},
) {
  if (request.schemaVersion !== 1) {
    throw new Error("unsupported_request_schema");
  }

  const authorityDecision = classifyAuthority({
    request,
    publicKey: authorityPublicKey,
    requireTrusted: requireTrustedAuthority,
    now: authorityNow,
    maxTtlSeconds: authorityMaxTtlSeconds,
    clockSkewSeconds: authorityClockSkewSeconds,
  });
  const authorization = authorizeMutation({
    mode: authorityDecision.effective.mutationMode,
    action: request.action,
    explicitInstruction: authorityDecision.effective.explicitInstruction,
    exactTextConfirmed: authorityDecision.effective.exactTextConfirmed,
  });
  if (!authorization.allowed) {
    throw new Error(`mutation_denied:${authorization.reason}`);
  }
  required(request.repo, "repo");
  if (PR_ACTIONS.has(request.action)) {
    positiveInteger(request.pr, "pr");
    required(request.expectedHead, "expected_head");
  }
  if (REVIEW_THREAD_ACTIONS.has(request.action)) {
    required(request.threadId, "thread_id");
  }
  if (request.action === "retarget_pr") {
    const expectedBase = required(request.expectedBase, "expected_base");
    const newBase = required(request.newBase, "new_base");
    if (expectedBase === newBase) throw new Error("retarget_base_unchanged");
  }
  if (CLEANUP_ACTIONS.has(request.action)) {
    positiveInteger(request.pr, "pr");
    required(request.headRefName, "head_ref_name");
    required(request.actorLogin, "actor_login");
    required(request.headOwnerLogin, "head_owner_login");
  }
  if (SOCIAL_ACTIONS.has(request.action)) {
    required(request.idempotencyKey, "idempotency_key");
  }
  if (request.action === "reply_human_thread") {
    const actualHash = sha256(required(visibleBody(request.body), "body"));
    if (request.exactTextSha256 !== actualHash) {
      throw new Error("exact_text_hash_mismatch");
    }
  }
  const normalized = structuredClone(request);
  delete normalized.authorityGrant;
  if (REMOTE_IDEMPOTENT_CREATE_ACTIONS.has(normalized.action)) {
    const marker = idempotencyMarker(normalized.idempotencyKey);
    normalized.idempotencyMarker = marker;
    normalized.body = bodyWithIdempotencyMarker(normalized.body, marker);
  }
  if (normalized.action === "delete_head_branch") {
    const decision = assertDeleteHeadBranchAllowed(normalized);
    normalized.targetRepo = decision.targetRepo;
    normalized.headRefName = decision.branch;
    normalized.repo = decision.targetRepo;
  }
  const command = commandFor(normalized);
  return {
    schemaVersion: 1,
    kind: "github-delivery/mutation-plan",
    request: normalized,
    requestHash: sha256(JSON.stringify(normalized)),
    action: normalized.action,
    repo: normalized.repo,
    pr: normalized.pr ?? null,
    expectedHead: normalized.expectedHead ?? null,
    expectedBase: normalized.expectedBase ?? null,
    newBase: normalized.newBase ?? null,
    idempotencyKey: normalized.idempotencyKey ?? null,
    idempotencyMarker: normalized.idempotencyMarker ?? null,
    authority: publicAuthorityReceipt(authorityDecision),
    authorization,
    command,
  };
}

export function executeMutationRequest({
  request,
  execute = false,
  runner = (command, args, options) => spawnSync(command, args, options),
  authorityPublicKey = null,
  requireTrustedAuthority = false,
  authorityNow,
  authorityMaxTtlSeconds,
  authorityClockSkewSeconds,
} = {}) {
  const plan = planMutationRequest(request, {
    authorityPublicKey,
    requireTrustedAuthority,
    authorityNow,
    authorityMaxTtlSeconds,
    authorityClockSkewSeconds,
  });
  if (!execute) {
    return { ...plan, executed: false, status: "dry_run", outcome: null };
  }

  const observedHead = verifyHead({ request: plan.request, runner });
  const threadTarget = verifyReviewThreadTarget({ request: plan.request, runner });
  const retargetState = verifyRetargetBase({ request: plan.request, runner });
  const commentEditTarget = verifyOwnCommentTarget({ request: plan.request, runner });
  const mergeState = readMergeState({ request: plan.request, runner });
  const preMergeOutcome = classifyMergeOutcome(mergeState);
  if (preMergeOutcome) {
    return {
      ...plan,
      executed: false,
      status: "already_applied",
      outcome: preMergeOutcome === "merged" ? "already_merged" : preMergeOutcome,
      observedHead,
      observedBase: retargetState?.observedBase ?? null,
      threadTarget,
      commentEditTarget,
      existingMutation: null,
      idempotencyClaim: null,
      stdout: "",
      verification: mergeState,
    };
  }
  if (threadTarget?.isResolved) {
    return {
      ...plan,
      executed: false,
      status: "already_applied",
      outcome: null,
      observedHead,
      observedBase: retargetState?.observedBase ?? null,
      threadTarget,
      commentEditTarget,
      existingMutation: null,
      idempotencyClaim: null,
      stdout: "",
      verification: threadTarget,
    };
  }
  if (retargetState?.alreadyApplied) {
    return {
      ...plan,
      executed: false,
      status: "already_applied",
      outcome: null,
      observedHead,
      observedBase: retargetState.observedBase,
      threadTarget,
      commentEditTarget,
      existingMutation: null,
      idempotencyClaim: null,
      stdout: "",
      verification: retargetState.observedBase,
    };
  }
  const existingMutation = findExistingIdempotentMutation({
    request: plan.request,
    runner,
  });
  if (existingMutation) {
    return {
      ...plan,
      executed: false,
      status: "already_applied",
      outcome: null,
      observedHead,
      observedBase: retargetState?.observedBase ?? null,
      threadTarget,
      commentEditTarget,
      existingMutation,
      idempotencyClaim: null,
      stdout: "",
      verification: null,
    };
  }

  const idempotencyClaim = acquireAutonomousIdempotencyClaim({
    request: plan.request,
    runner,
  });
  const stdout = runOrThrow(runner, plan.command);
  const branchDeletion = verifyBranchDeleted({ request: plan.request, runner });
  let verification;
  let outcome = null;
  if (plan.request.action === "merge_pr") {
    verification = readMergeState({ request: plan.request, runner });
    outcome = classifyMergeOutcome(verification);
    if (!outcome) throw new Error("merge_outcome_unverified");
  } else if (REVIEW_THREAD_ACTIONS.has(plan.request.action)) {
    verification = verifyReviewThreadTarget({ request: plan.request, runner });
    if (verification.isResolved !== true) {
      throw new Error("review_thread_resolution_verification_failed");
    }
  } else {
    const verify = verificationCommand(plan.request);
    verification = verify ? runOrThrow(runner, verify) : branchDeletion;
  }
  if (plan.request.action === "retarget_pr" && verification !== plan.request.newBase) {
    throw new Error(
      `retarget_verification_failed: expected ${plan.request.newBase}, observed ${verification || "missing"}`,
    );
  }

  return {
    ...plan,
    executed: true,
    status: "succeeded",
    outcome,
    observedHead,
    observedBase: retargetState?.observedBase ?? null,
    threadTarget,
    commentEditTarget,
    existingMutation: null,
    idempotencyClaim,
    stdout,
    verification,
  };
}
