import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

import { classifyAuthority } from "./authority-grant.mjs";
import {
  exactIdempotencyRecordMatches,
  markerCandidates,
  readAuthenticatedActor,
} from "./idempotency-receipt.mjs";
import { authorizeMutation } from "./mutation-policy.mjs";
import {
  lifecycleCommandFor,
  preflightLifecycleMutation,
  validateLifecycleMutation,
  verifyLifecycleMutation,
} from "./lifecycle-mutations.mjs";

const ACTIONS = new Set([
  "push_code",
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
  const expected = String(required(request.expectedHead, "expected_head"));
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
  ]);
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
    return `repos/${request.repo}/pulls?state=all&per_page=100`;
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
  runner = (command, args, options) => spawnSync(command, args, options),
  authorityPublicKey = null,
  requireTrustedAuthority = false,
  authorityNow,
  authorityMaxTtlSeconds,
  authorityClockSkewSeconds,
} = {}) {
  const plan = planLifecycleMutationRequest(request, {
    authorityPublicKey,
    requireTrustedAuthority,
    authorityNow,
    authorityMaxTtlSeconds,
    authorityClockSkewSeconds,
  });
  if (!execute) return { ...plan, executed: false, status: "dry_run" };

  const observedHead = verifyHead({ request: plan.request, runner });
  const preflight = preflightLifecycleMutation({ request: plan.request, runner });
  const existingMutation = findExistingCreate({ request: plan.request, runner });
  if (existingMutation) {
    return {
      ...plan,
      executed: false,
      status: "already_applied",
      observedHead,
      preflight,
      existingMutation,
      stdout: "",
      verification: existingMutation,
    };
  }

  const stdout = runOrThrow(runner, plan.command);
  let verification = verifyLifecycleMutation({ request: plan.request, runner });
  if (IDEMPOTENT_CREATES.has(plan.action)) {
    verification = findExistingCreate({ request: plan.request, runner });
    if (!verification) throw new Error(`${plan.action}_verification_failed:idempotency_receipt_mismatch`);
  }
  return {
    ...plan,
    executed: true,
    status: "succeeded",
    observedHead,
    preflight,
    existingMutation: null,
    stdout,
    verification,
  };
}
