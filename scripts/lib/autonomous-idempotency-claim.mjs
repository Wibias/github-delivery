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

export const AUTONOMOUS_CLAIM_RECOVERY_AGE_MS = 30 * 60 * 1000;
const CLAIM_KIND = "github-delivery/autonomous-idempotency-claim";

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

function refPath(ref) {
  return String(ref)
    .replace(/^refs\//, "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function run(runner, args) {
  return runner("gh", args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
}

function runOrThrow(runner, args, code) {
  const result = run(runner, args);
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new Error(`${code}${detail ? `:${detail}` : ""}`);
  }
  return String(result.stdout || "").trim();
}

function parseObject(output, code) {
  try {
    const value = JSON.parse(output || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not_object");
    return value;
  } catch {
    throw new Error(code);
  }
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

function claimScopeSha256(request) {
  return sha256(JSON.stringify({
    repo: String(required(request.repo, "repo")).toLowerCase(),
    action: required(request.action, "action"),
    pr: request.pr ?? null,
    issue: request.issue ?? null,
    commentId: request.commentId ?? null,
    expectedHead: request.expectedHead ?? null,
    idempotencyKeySha256: sha256(required(request.idempotencyKey, "idempotency_key")),
    bodySha256: sha256(request.body ?? ""),
    titleSha256: sha256(request.title ?? ""),
  }));
}

function claimMessage({ request, anchorSha, createdAt }) {
  return JSON.stringify({
    schemaVersion: 1,
    kind: CLAIM_KIND,
    createdAt,
    repo: String(request.repo).toLowerCase(),
    action: request.action,
    scopeSha256: claimScopeSha256(request),
    anchorSha,
  });
}

function createClaimObject({ request, anchorSha, runner, now }) {
  const { owner, name } = repoParts(required(request.repo, "repo"));
  const createdAt = new Date(now).toISOString();
  const payload = parseObject(
    runOrThrow(
      runner,
      [
        "api",
        `repos/${owner}/${name}/git/tags`,
        "--method",
        "POST",
        "-f",
        "tag=github-delivery-idempotency-claim",
        "-f",
        `message=${claimMessage({ request, anchorSha, createdAt })}`,
        "-f",
        `object=${anchorSha}`,
        "-f",
        "type=commit",
      ],
      "autonomous_idempotency_claim_object_failed",
    ),
    "autonomous_idempotency_claim_object_invalid",
  );
  const objectSha = String(payload.sha || "").trim();
  if (!objectSha) throw new Error("autonomous_idempotency_claim_object_sha_missing");
  return { objectSha, createdAt };
}

function readExistingClaim({ request, runner }) {
  const repo = required(request.repo, "repo");
  const { owner, name } = repoParts(repo);
  const ref = autonomousIdempotencyClaimRef(request);
  const reference = parseObject(
    runOrThrow(
      runner,
      ["api", `repos/${owner}/${name}/git/ref/${refPath(ref)}`],
      "autonomous_idempotency_claim_ref_unreadable",
    ),
    "autonomous_idempotency_claim_ref_invalid",
  );
  const objectSha = String(reference.object?.sha || "").trim();
  if (!objectSha || reference.object?.type !== "tag") {
    throw new Error(
      `autonomous_idempotency_claim_legacy_or_invalid:${ref}: legacy claims require one-time manual cleanup because their creation time was never recorded`,
    );
  }
  const tag = parseObject(
    runOrThrow(
      runner,
      ["api", `repos/${owner}/${name}/git/tags/${objectSha}`],
      "autonomous_idempotency_claim_tag_unreadable",
    ),
    "autonomous_idempotency_claim_tag_invalid",
  );
  let metadata;
  try {
    metadata = JSON.parse(String(tag.message || ""));
  } catch {
    throw new Error(`autonomous_idempotency_claim_metadata_invalid:${ref}`);
  }
  if (
    metadata?.schemaVersion !== 1 ||
    metadata?.kind !== CLAIM_KIND ||
    metadata?.repo !== String(repo).toLowerCase() ||
    metadata?.action !== request.action ||
    metadata?.scopeSha256 !== claimScopeSha256(request)
  ) {
    throw new Error(`autonomous_idempotency_claim_scope_mismatch:${ref}`);
  }
  const createdAtMs = Date.parse(metadata.createdAt || "");
  if (!Number.isFinite(createdAtMs)) {
    throw new Error(`autonomous_idempotency_claim_created_at_invalid:${ref}`);
  }
  return { ref, objectSha, createdAt: metadata.createdAt, createdAtMs };
}

function deleteStaleClaim({ request, claim, runner, now }) {
  const { owner, name } = repoParts(required(request.repo, "repo"));
  const current = readExistingClaim({ request, runner });
  if (current.objectSha !== claim.objectSha) {
    throw new Error(`autonomous_idempotency_claim_changed:${claim.ref}`);
  }
  if (now < current.createdAtMs + AUTONOMOUS_CLAIM_RECOVERY_AGE_MS) {
    throw new Error(`autonomous_idempotency_claim_conflict:${claim.ref}:not_stale_on_delete`);
  }
  runOrThrow(
    runner,
    ["api", `repos/${owner}/${name}/git/refs/${refPath(claim.ref)}`, "--method", "DELETE"],
    "autonomous_idempotency_claim_recovery_delete_failed",
  );
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

export function verifyAutonomousIdempotencyClaim({ request, claim, runner } = {}) {
  if (!claim) return null;
  const current = readExistingClaim({ request, runner });
  if (current.objectSha !== claim.objectSha) {
    throw new Error(`autonomous_idempotency_claim_lost:${claim.ref}`);
  }
  return current;
}

export function acquireAutonomousIdempotencyClaim({
  request,
  runner,
  now = Date.now(),
} = {}) {
  if (!requiresAutonomousIdempotencyClaim(request)) return null;
  if (typeof runner !== "function") throw new Error("autonomous_idempotency_runner_required");
  const repo = required(request.repo, "repo");
  const { owner, name } = repoParts(repo);
  const ref = autonomousIdempotencyClaimRef(request);
  const anchorSha = readAnchorSha(request, runner);

  const create = () => {
    const claimObject = createClaimObject({ request, anchorSha, runner, now });
    const result = run(runner, [
      "api",
      `repos/${owner}/${name}/git/refs`,
      "--method",
      "POST",
      "-f",
      `ref=${ref}`,
      "-f",
      `sha=${claimObject.objectSha}`,
    ]);
    if (result.status === 0) {
      return {
        ref,
        anchorSha,
        objectSha: claimObject.objectSha,
        createdAt: claimObject.createdAt,
        status: "claimed",
      };
    }
    const detail = String(result.stderr || result.stdout || "").trim();
    if (/\b(?:409|422)\b|already exists|reference already exists/i.test(detail)) return null;
    throw new Error(
      `autonomous_idempotency_claim_failed:${ref}${detail ? `:${detail}` : ""}`,
    );
  };

  const created = create();
  if (created) return created;

  const existing = readExistingClaim({ request, runner });
  const recoverAfterMs = existing.createdAtMs + AUTONOMOUS_CLAIM_RECOVERY_AGE_MS;
  if (now < recoverAfterMs) {
    throw new Error(
      `autonomous_idempotency_claim_conflict:${ref}:recoverable_after=${new Date(recoverAfterMs).toISOString()}`,
    );
  }

  deleteStaleClaim({ request, claim: existing, runner, now });
  const recovered = create();
  if (!recovered) {
    throw new Error(`autonomous_idempotency_claim_recovery_raced:${ref}`);
  }
  return { ...recovered, status: "recovered_stale_claim", recoveredObjectSha: existing.objectSha };
}
