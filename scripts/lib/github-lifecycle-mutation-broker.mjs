import { createHash } from "node:crypto";

import { classifyAuthority } from "./authority-grant.mjs";
import {
  exactIdempotencyRecordMatches,
  markerCandidates,
  readAuthenticatedActor,
} from "./idempotency-receipt.mjs";
import { authorizeMutation } from "./mutation-policy.mjs";
import { createFileRewriteBaselineStore } from "./rewrite-baseline-store.mjs";
import {
  lifecycleCommandFor,
  preflightLifecycleMutation,
  validateLifecycleMutation,
  verifyLifecycleMutation,
} from "./lifecycle-mutations.mjs";
import { boundedSpawnSync } from "./subprocess-policy.mjs";

const ACTIONS = new Set([
  "push_code",
  "record_rewrite_baseline",
  "create_pr",
  "update_pr_body",
  "create_issue",
  "assign_issue",
]);
const PR_ACTIONS = new Set(["update_pr_body"]);
const IDEMPOTENT_CREATES = new Set(["create_pr", "create_issue"]);
const IDEMPOTENCY_MARKER_RE = /\n\n<!-- github-delivery:idempotency [0-9a-f]{64} -->\s*$/i;

function sha256(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function required(value, name) {
  if (value === undefined || value === null || value === "") throw new Error(`${name}_required`);
  return value;
}

function idempotencyMarker(key) {
  return `<!-- github-delivery:idempotency ${sha256(required(key, "idempotency_key"))} -->`;
}

function visibleBody(value) {
  return String(value ?? "").replace(IDEMPOTENCY_MARKER_RE, "");
}

function bodyWithMarker(body, marker) {
  return `${visibleBody(required(body, "body")).trimEnd()}\n\n${marker}`;
}

function runCommand(runner, command) {
  const [executable, ...args] = command;
  return runner(executable, args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
}

function runOrThrow(runner, command) {
  const result = runCommand(runner, command);
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new Error(detail || `mutation_command_failed:${result.status}`);
  }
  return String(result.stdout || "").trim();
}

function uncertainSpawn(result) {
  return result?.status == null || Boolean(result?.signal);
}

function spawnFailure(result) {
  const detail = String(result?.stderr || result?.stdout || "").trim();
  return new Error(detail || `mutation_command_failed:${result?.status ?? "unknown"}`);
}

function readPushedTip(request, runner) {
  const result = runCommand(runner, [
    "git",
    "ls-remote",
    "--heads",
    String(request.remote),
    `refs/heads/${request.branch}`,
  ]);
  if (result.status !== 0) {
    throw new Error("push_outcome_unknown:remote_unreadable");
  }
  const row = String(result.stdout || "").trim();
  return row ? String(row.split(/\s+/)[0] || "").toLowerCase() : "absent";
}

function reconcileUncertainPush({ plan, runner, writeResult, baselineStore }) {
  const observed = readPushedTip(plan.request, runner);
  const expected = String(plan.request.newTip || "").toLowerCase();
  if (observed === expected) {
    return {
      executed: true,
      status: "reconciled_after_error",
      stdout: String(writeResult?.stdout || "").trim(),
      verification: verifyLifecycleMutation({
        request: plan.request,
        runner,
        baselineStore,
      }),
    };
  }
  const previous = String(plan.request.expectedRemoteTip || "").toLowerCase();
  if (observed === previous) throw spawnFailure(writeResult);
  throw new Error(
    `push_outcome_unknown: expected ${expected}, previous ${previous}, observed ${observed}`,
  );
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

function verifyHead({ request, runner }) {
  if (!PR_ACTIONS.has(request.action)) return null;
  const expected = String(required(request.expectedHead, "expected_head")).trim().toLowerCase();
  const observed = runOrThrow(runner, [
    "gh",
    "pr",
    "view",
    String(request.pr),
    "--repo",
    String(required(request.repo, "repo")),
    "--json",
    "headRefOid",
    "--jq",
    ".headRefOid",
  ]).trim().toLowerCase();
  if (observed !== expected) {
    throw new Error(`expected_head_mismatch: expected ${expected}, observed ${observed || "missing"}`);
  }
  return observed;
}

function parsePages(output) {
  let payload;
  try {
    payload = JSON.parse(output || "[]");
  } catch {
    throw new Error("idempotency_lookup_invalid_json");
  }
  if (!Array.isArray(payload)) throw new Error("idempotency_lookup_invalid_payload");
  return payload.flatMap((page) => (Array.isArray(page) ? page : page && typeof page === "object" ? [page] : []));
}

function lookupPath(request) {
  if (request.action === "create_pr") {
    const repo = String(required(request.repo, "repo")).trim();
    const head = String(request.head || "").trim();
    if (!head) throw new Error("create_pr_head_required");
    const owner = repo.split("/")[0];
    const headFilter = head.includes(":") ? head : `${owner}:${head}`;
    // REST requires a user/org-qualified `head` filter. Keep the idempotency
    // scan bounded to the intended branch rather than enumerating every pull.
    return `repos/${repo}/pulls?state=all&per_page=100&head=${encodeURIComponent(headFilter)}`;
  }
  if (request.action === "create_issue") {
    return `repos/${request.repo}/issues?state=all&per_page=100`;
  }
  return null;
}

function findExistingCreate({ request, runner }) {
  if (!IDEMPOTENT_CREATES.has(request.action)) return null;
  const marker = String(required(request.idempotencyMarker, "idempotency_marker"));
  const rows = parsePages(
    runOrThrow(runner, ["gh", "api", lookupPath(request), "--paginate", "--slurp"]),
  );
  const candidates = markerCandidates(rows, marker);
  if (!candidates.length) return null;
  const actorLogin = readAuthenticatedActor(runner);
  const row = candidates.find((entry) =>
    exactIdempotencyRecordMatches({ record: entry, request, actorLogin }),
  );
  if (!row) return null;
  return {
    id: row.id ?? null,
    number: row.number ?? null,
    url: row.html_url || row.url || null,
  };
}

export function isLifecycleMutationAction(action) {
  return ACTIONS.has(String(action || ""));
}

export function planLifecycleMutationRequest(
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
  if (!isLifecycleMutationAction(request.action)) throw new Error(`unsupported_lifecycle_action:${request.action}`);

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
  validateLifecycleMutation(request);

  const normalized = structuredClone(request);
  delete normalized.authorityGrant;
  if (IDEMPOTENT_CREATES.has(normalized.action)) {
    const marker = idempotencyMarker(normalized.idempotencyKey);
    normalized.idempotencyMarker = marker;
    normalized.body = bodyWithMarker(normalized.body, marker);
  }
  const command = lifecycleCommandFor(normalized);
  return {
    schemaVersion: 1,
    kind: "github-delivery/mutation-plan",
    request: normalized,
    requestHash: sha256(JSON.stringify(normalized)),
    action: normalized.action,
    repo: normalized.repo,
    pr: normalized.pr ?? null,
    expectedHead: normalized.expectedHead ?? null,
    idempotencyKey: normalized.idempotencyKey ?? null,
    idempotencyMarker: normalized.idempotencyMarker ?? null,
    authority: publicAuthorityReceipt(authorityDecision),
    authorization,
    command,
  };
}

export function executeLifecycleMutationRequest({
  request,
  execute = false,
  runner = boundedSpawnSync,
  authorityPublicKey = null,
  requireTrustedAuthority = false,
  authorityNow,
  authorityMaxTtlSeconds,
  authorityClockSkewSeconds,
  baselineStore,
} = {}) {
  const plan = planLifecycleMutationRequest(request, {
    authorityPublicKey,
    requireTrustedAuthority,
    authorityNow,
    authorityMaxTtlSeconds,
    authorityClockSkewSeconds,
  });
  if (!execute) return { ...plan, executed: false, status: "dry_run" };
  const store = baselineStore || createFileRewriteBaselineStore();

  const observedHead = verifyHead({ request: plan.request, runner });

  // Recover an exact same-actor/idempotency create before broader publication
  // preflights. Otherwise an already-created PR would be rejected as a generic
  // exact-head duplicate before its durable receipt can converge the retry.
  const existingMutation = findExistingCreate({ request: plan.request, runner });
  if (existingMutation) {
    return {
      ...plan,
      executed: false,
      status: "already_applied",
      observedHead,
      preflight: null,
      existingMutation,
      stdout: "",
      verification: existingMutation,
    };
  }

  const preflight = preflightLifecycleMutation({ request: plan.request, runner, baselineStore: store });
  let stdout;
  let status = "succeeded";
  let verification;
  if (plan.action === "push_code") {
    const writeResult = runCommand(runner, plan.command);
    if (uncertainSpawn(writeResult)) {
      const reconciled = reconcileUncertainPush({ plan, runner, writeResult, baselineStore: store });
      stdout = reconciled.stdout;
      status = reconciled.status;
      verification = reconciled.verification;
    } else if (writeResult.status !== 0) {
      throw spawnFailure(writeResult);
    } else {
      stdout = String(writeResult.stdout || "").trim();
      verification = verifyLifecycleMutation({ request: plan.request, runner, baselineStore: store });
    }
  } else {
    stdout = runOrThrow(runner, plan.command);
    verification = verifyLifecycleMutation({ request: plan.request, runner, baselineStore: store });
  }
  if (IDEMPOTENT_CREATES.has(plan.action)) {
    verification = findExistingCreate({ request: plan.request, runner });
    if (!verification) throw new Error(`${plan.action}_verification_failed:idempotency_receipt_mismatch`);
  }
  return {
    ...plan,
    executed: true,
    status,
    observedHead,
    preflight,
    existingMutation: null,
    stdout,
    verification,
  };
}
