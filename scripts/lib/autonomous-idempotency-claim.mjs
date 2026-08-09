import { createHash } from "node:crypto";

const CLAIMED_ACTIONS = new Set([
  "post_review",
  "post_comment",
  "post_issue_comment",
  "reply_bot_thread",
  "reply_human_thread",
  "create_follow_up_issue",
  "post_resolution_record",
]);

function sha256(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function required(value, name) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`${name}_required`);
  }
  return value;
}

function repoParts(repo) {
  const parts = String(repo || "").split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("repo_invalid");
  return { owner: parts[0], name: parts[1] };
}

function run(runner, args) {
  return runner("gh", args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
}

function readAnchorSha(request, runner) {
  if (request.expectedHead) return String(request.expectedHead);
  const repo = required(request.repo, "repo");
  const { owner, name } = repoParts(repo);
  const repoResult = run(runner, ["api", `repos/${owner}/${name}`, "--jq", ".default_branch"]);
  if (repoResult.status !== 0) {
    throw new Error("autonomous_idempotency_anchor_repo_unreadable");
  }
  const branch = String(repoResult.stdout || "").trim();
  if (!branch) throw new Error("autonomous_idempotency_anchor_branch_missing");
  const refResult = run(runner, [
    "api",
    `repos/${owner}/${name}/git/ref/heads/${branch.split("/").map(encodeURIComponent).join("/")}`,
    "--jq",
    ".object.sha",
  ]);
  if (refResult.status !== 0) {
    throw new Error("autonomous_idempotency_anchor_ref_unreadable");
  }
  const sha = String(refResult.stdout || "").trim();
  if (!sha) throw new Error("autonomous_idempotency_anchor_sha_missing");
  return sha;
}

export function autonomousIdempotencyClaimRef(request = {}) {
  const repo = required(request.repo, "repo").toLowerCase();
  const action = required(request.action, "action");
  const key = required(request.idempotencyKey, "idempotency_key");
  return `refs/github-delivery/idempotency/${sha256(`${repo}\u0000${action}\u0000${key}`)}`;
}

export function requiresAutonomousIdempotencyClaim(request = {}) {
  return request.mutationMode === "autonomous" && CLAIMED_ACTIONS.has(request.action);
}

export function acquireAutonomousIdempotencyClaim({ request, runner } = {}) {
  if (!requiresAutonomousIdempotencyClaim(request)) return null;
  if (typeof runner !== "function") throw new Error("autonomous_idempotency_runner_required");
  const repo = required(request.repo, "repo");
  const { owner, name } = repoParts(repo);
  const ref = autonomousIdempotencyClaimRef(request);
  const anchorSha = readAnchorSha(request, runner);
  const result = run(runner, [
    "api",
    `repos/${owner}/${name}/git/refs`,
    "--method",
    "POST",
    "-f",
    `ref=${ref}`,
    "-f",
    `sha=${anchorSha}`,
  ]);
  if (result.status === 0) {
    return { ref, anchorSha, status: "claimed" };
  }
  const detail = String(result.stderr || result.stdout || "").trim();
  if (/\b(?:409|422)\b|already exists|reference already exists/i.test(detail)) {
    throw new Error(`autonomous_idempotency_claim_conflict:${ref}`);
  }
  throw new Error(
    `autonomous_idempotency_claim_failed:${ref}${detail ? `:${detail}` : ""}`,
  );
}
