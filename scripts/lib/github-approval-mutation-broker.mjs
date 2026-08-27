import { createHash } from "node:crypto";

import { classifyAuthority } from "./authority-grant.mjs";
import { authorizeMutation } from "./mutation-policy.mjs";
import { boundedSpawnSync } from "./subprocess-policy.mjs";

function sha256(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function required(value, name) {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${name}_required`);
  }
  return value;
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${name}_invalid`);
  return number;
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

function idempotencyMarker(key) {
  return `<!-- github-delivery:idempotency ${sha256(key)} -->`;
}

function bodyWithMarker(body, marker) {
  const visible = String(body || "").trimEnd();
  return visible ? `${visible}\n\n${marker}` : marker;
}

function run(runner, command, args) {
  const result = runner(command, args, { encoding: "utf8" });
  if (result?.error || result?.status !== 0) {
    const detail = String(result?.stderr || result?.stdout || result?.error?.message || "").trim();
    throw new Error(detail || `mutation_command_failed:${command}`);
  }
  return String(result?.stdout || "").trim();
}

function observedHead(request, runner) {
  const value = run(runner, "gh", [
    "pr",
    "view",
    String(request.pr),
    "--repo",
    request.repo,
    "--json",
    "headRefOid",
    "--jq",
    ".headRefOid",
  ]);
  if (value !== request.expectedHead) {
    throw new Error(`pr_head_mismatch: expected ${request.expectedHead}, observed ${value || "missing"}`);
  }
  return value;
}

function actorLogin(runner) {
  const raw = run(runner, "gh", ["api", "user"]);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("approve_pr_actor_identity_invalid");
  }
  return String(parsed?.login || "").trim();
}

function authorLogin(request, runner) {
  return run(runner, "gh", [
    "pr",
    "view",
    String(request.pr),
    "--repo",
    request.repo,
    "--json",
    "author",
    "--jq",
    ".author.login",
  ]);
}

function reviews(request, runner) {
  const raw = run(runner, "gh", [
    "api",
    `repos/${request.repo}/pulls/${request.pr}/reviews`,
    "--paginate",
  ]);
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("approve_pr_reviews_invalid");
  }
  return Array.isArray(parsed) ? parsed : [];
}

function matchingApproval(request, runner) {
  return reviews(request, runner).find((review) =>
    String(review?.state || "").toUpperCase() === "APPROVED" &&
    String(review?.body || "").includes(request.idempotencyMarker),
  ) || null;
}

export function planApprovalMutationRequest(
  request = {},
  {
    authorityPublicKey = null,
    requireTrustedAuthority = false,
    authorityNow,
    authorityMaxTtlSeconds,
    authorityClockSkewSeconds,
  } = {},
) {
  if (request.schemaVersion !== 1) throw new Error("unsupported_request_schema");
  if (request.action !== "approve_pr") throw new Error("approve_pr_action_required");

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
  if (!authorization.allowed) throw new Error(`mutation_denied:${authorization.reason}`);

  required(request.repo, "repo");
  positiveInteger(request.pr, "pr");
  required(request.expectedHead, "expected_head");
  required(request.idempotencyKey, "idempotency_key");

  const normalized = structuredClone(request);
  delete normalized.authorityGrant;
  normalized.idempotencyMarker = idempotencyMarker(normalized.idempotencyKey);
  normalized.body = bodyWithMarker(normalized.body, normalized.idempotencyMarker);

  return {
    schemaVersion: 1,
    kind: "github-delivery/mutation-plan",
    request: normalized,
    requestHash: sha256(JSON.stringify(normalized)),
    action: normalized.action,
    repo: normalized.repo,
    pr: normalized.pr,
    expectedHead: normalized.expectedHead,
    expectedBase: null,
    newBase: null,
    idempotencyKey: normalized.idempotencyKey,
    idempotencyMarker: normalized.idempotencyMarker,
    authority: publicAuthorityReceipt(authorityDecision),
    authorization,
    command: [
      "gh",
      "pr",
      "review",
      String(normalized.pr),
      "--repo",
      normalized.repo,
      "--approve",
      "--body",
      normalized.body,
    ],
  };
}

export function executeApprovalMutationRequest({
  request,
  execute = false,
  runner = boundedSpawnSync,
  authorityPublicKey = null,
  requireTrustedAuthority = false,
  authorityNow,
  authorityMaxTtlSeconds,
  authorityClockSkewSeconds,
} = {}) {
  const plan = planApprovalMutationRequest(request, {
    authorityPublicKey,
    requireTrustedAuthority,
    authorityNow,
    authorityMaxTtlSeconds,
    authorityClockSkewSeconds,
  });
  if (!execute) return { ...plan, executed: false, status: "dry_run", outcome: null };

  const head = observedHead(plan.request, runner);
  const actor = actorLogin(runner);
  const author = authorLogin(plan.request, runner);
  if (!actor || !author) throw new Error("approve_pr_identity_missing");
  if (actor.toLowerCase() === author.toLowerCase()) {
    throw new Error(`approve_pr_self_approval_forbidden:${actor}`);
  }

  const existing = matchingApproval(plan.request, runner);
  if (existing) {
    return {
      ...plan,
      executed: false,
      status: "already_applied",
      outcome: null,
      observedHead: head,
      existingMutation: existing,
      stdout: "",
      verification: existing,
    };
  }

  const stdout = run(runner, plan.command[0], plan.command.slice(1));
  const verification = matchingApproval(plan.request, runner);
  if (!verification) throw new Error("approve_review_verification_failed");

  return {
    ...plan,
    executed: true,
    status: "succeeded",
    outcome: null,
    observedHead: head,
    existingMutation: null,
    stdout,
    verification,
  };
}
