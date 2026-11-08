import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

import { boundedSpawnSync } from "./subprocess-policy.mjs";
import {
  normalizeRepositoryKey,
  readUserConfig,
  resolveCiEvidenceMode,
  userConfigPath,
} from "./user-config.mjs";

export const LOCAL_CI_RECEIPT_SCHEMA_VERSION = 1;
export const LOCAL_CI_RECEIPT_KIND = "github-delivery/local-ci-evidence";
export const MAX_LOCAL_EVIDENCE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function localEvidenceRoot(options = {}) {
  return join(dirname(userConfigPath(options)), "local-ci-evidence");
}

export function localEvidenceReceiptPath({ repo, pr, headSha, ...options } = {}) {
  const [owner, name] = normalizeRepositoryKey(repo).split("/");
  const number = Number(pr);
  const head = String(headSha || "").trim().toLowerCase();
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error("local_evidence_pr_required");
  }
  if (!/^[0-9a-f]{40}$/.test(head)) {
    throw new Error("local_evidence_head_sha_required");
  }
  return join(
    localEvidenceRoot(options),
    owner,
    name,
    `pr-${number}`,
    `${head}.json`,
  );
}

export function canonicalReceiptHash(receipt) {
  const { receiptHash, ...body } = receipt || {};
  return createHash("sha256")
    .update(JSON.stringify(body), "utf8")
    .digest("hex");
}

function fileDigest(readFile, path) {
  const body = readFile(path);
  return createHash("sha256")
    .update(Buffer.isBuffer(body) ? body : Buffer.from(String(body), "utf8"))
    .digest("hex");
}

function parseTimestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

const ancestryCache = new Map();

export function ghBaseAncestry(
  { repo, ancestor, descendant },
  runner = boundedSpawnSync,
) {
  const key = `${normalizeRepositoryKey(repo)}:${ancestor}:${descendant}`;
  if (ancestryCache.has(key)) return ancestryCache.get(key);
  const result = runner(
    "gh",
    [
      "api",
      `repos/${repo}/compare/${ancestor}...${descendant}`,
      "--jq",
      ".status",
    ],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
  if (result.status !== 0) return null;
  const status = String(result.stdout || "").trim().toLowerCase();
  let answer = null;
  if (status === "ahead" || status === "identical") answer = true;
  else if (status === "behind" || status === "diverged") answer = false;
  ancestryCache.set(key, answer);
  return answer;
}

function publicReceipt(receipt) {
  return {
    headSha: receipt.headSha,
    baseSha: receipt.baseSha,
    pullRequest: receipt.pullRequest,
    repository: receipt.repository,
    waiver: receipt.waiver,
    recordedAt: receipt.recordedAt,
    completedAt: receipt.completedAt,
    runner: receipt.runner || null,
    commands: Array.isArray(receipt.commands) ? receipt.commands : [],
    log: receipt.log ? { path: receipt.log.path, sha256: receipt.log.sha256 } : null,
    receiptHash: receipt.receiptHash || null,
  };
}

export function evaluateLocalCiEvidence({
  config,
  repo,
  pr,
  headSha,
  baseSha = null,
  headCommittedAt = null,
  receiptPath = undefined,
  configError = null,
  exists = existsSync,
  readFile = readFileSync,
  stat = statSync,
  now = Date.now(),
  maxAgeMs = MAX_LOCAL_EVIDENCE_AGE_MS,
  isBaseAncestor = ghBaseAncestry,
} = {}) {
  const mode = resolveCiEvidenceMode({ config, repo });
  if (mode.mode !== "local") {
    return {
      mode: "remote",
      active: false,
      applicable: false,
      valid: false,
      reasons: [],
      path: null,
      receipt: null,
    };
  }

  const reasons = [];
  const fail = (reason) => {
    if (!reasons.includes(reason)) reasons.push(reason);
  };
  if (configError) fail("local_evidence_config_unreadable");

  const head = String(headSha || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(head)) fail("local_evidence_head_sha_invalid");
  const path = receiptPath || localEvidenceReceiptPath({ repo, pr, headSha: head });

  let receipt = null;
  if (!exists(path)) {
    fail("local_evidence_missing");
  } else {
    try {
      receipt = JSON.parse(readFile(path, "utf8"));
    } catch {
      fail("local_evidence_invalid_json");
    }
  }

  if (receipt !== null && (typeof receipt !== "object" || Array.isArray(receipt))) {
    fail("local_evidence_invalid_receipt");
    receipt = null;
  }

  if (receipt) {
    if (receipt.schemaVersion !== LOCAL_CI_RECEIPT_SCHEMA_VERSION) {
      fail("local_evidence_schema_unsupported");
    }
    if (receipt.kind !== LOCAL_CI_RECEIPT_KIND) {
      fail("local_evidence_kind_invalid");
    }
    if (receipt.receiptHash !== canonicalReceiptHash(receipt)) {
      fail("local_evidence_receipt_tampered");
    }
    if (
      String(receipt.repository || "").toLowerCase() !==
      String(repo || "").toLowerCase()
    ) {
      fail("local_evidence_foreign_repository");
    }
    if (Number(receipt.pullRequest) !== Number(pr)) {
      fail("local_evidence_pull_request_mismatch");
    }
    if (String(receipt.headSha || "").toLowerCase() !== head) {
      fail("local_evidence_head_mismatch");
    }

    const receiptBase = String(receipt.baseSha || "").toLowerCase();
    const currentBase = String(baseSha || "").toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(receiptBase)) {
      fail("local_evidence_base_missing");
    } else if (!/^[0-9a-f]{40}$/.test(currentBase)) {
      fail("local_evidence_base_unavailable");
    } else if (receiptBase !== currentBase) {
      let ancestry = null;
      try {
        ancestry = isBaseAncestor({
          repo,
          ancestor: receiptBase,
          descendant: currentBase,
        });
      } catch {
        ancestry = null;
      }
      if (ancestry === false) fail("local_evidence_base_not_ancestor");
      else if (ancestry !== true) fail("local_evidence_base_ancestry_unknown");
    }

    if (String(receipt.waiver || "").trim() !== String(mode.waiver || "").trim()) {
      fail("local_evidence_waiver_mismatch");
    }

    const commands = Array.isArray(receipt.commands) ? receipt.commands : [];
    if (!commands.length) fail("local_evidence_commands_missing");
    for (const entry of commands) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        fail("local_evidence_command_invalid");
        continue;
      }
      if (!String(entry.command || "").trim()) fail("local_evidence_command_missing");
      if (!String(entry.scope || "").trim()) fail("local_evidence_scope_missing");
      if (Number(entry.exitCode) !== 0) fail("local_evidence_command_failed");
    }
    if (Number(receipt.exitCode) !== 0) fail("local_evidence_exit_code_failed");

    const completedAt = parseTimestamp(receipt.completedAt);
    const recordedAt = parseTimestamp(receipt.recordedAt);
    if (completedAt === null) fail("local_evidence_completed_at_invalid");
    if (recordedAt === null) fail("local_evidence_recorded_at_invalid");
    if (completedAt !== null) {
      if (completedAt > now + 5 * 60 * 1000) fail("local_evidence_completed_at_in_future");
      if (now - completedAt > maxAgeMs) fail("local_evidence_stale");
      const headTime = parseTimestamp(headCommittedAt);
      if (headTime !== null && completedAt < headTime) {
        fail("local_evidence_predates_head");
      }
    }

    if (!String(receipt.runner?.host || "").trim()) fail("local_evidence_runner_missing");
    for (const tool of ["node", "npm", "git"]) {
      if (!String(receipt.tools?.[tool] || "").trim()) {
        fail("local_evidence_tool_versions_incomplete");
      }
    }

    const log = receipt.log;
    if (!log || typeof log !== "object" || Array.isArray(log)) {
      fail("local_evidence_log_missing");
    } else if (!String(log.path || "").trim() || !isAbsolute(String(log.path))) {
      fail("local_evidence_log_path_invalid");
    } else if (!exists(log.path)) {
      fail("local_evidence_log_unreadable");
    } else {
      if (!Number.isSafeInteger(Number(log.bytes)) || Number(log.bytes) < 0) {
        fail("local_evidence_log_size_invalid");
      }
      let digest = null;
      let info = null;
      try {
        digest = fileDigest(readFile, log.path);
        info = stat(log.path);
      } catch {
        fail("local_evidence_log_unreadable");
      }
      if (digest && String(log.sha256 || "").toLowerCase() !== digest) {
        fail("local_evidence_log_hash_mismatch");
      }
      if (info && Number.isSafeInteger(Number(log.bytes)) && Number(log.bytes) !== info.size) {
        fail("local_evidence_log_size_mismatch");
      }
    }
  }

  return {
    mode: "local",
    active: true,
    applicable: true,
    valid: reasons.length === 0,
    reasons,
    path,
    receipt: receipt ? publicReceipt(receipt) : null,
  };
}

export function resolveLocalCiEvidenceForSnapshot(
  snapshot,
  { readConfig = readUserConfig, ...options } = {},
) {
  const repo = snapshot?.repo;
  if (!repo) {
    return {
      mode: "remote",
      active: false,
      applicable: false,
      valid: false,
      reasons: [],
      path: null,
      receipt: null,
    };
  }
  let config;
  let configError = null;
  try {
    config = readConfig().config;
  } catch (error) {
    config = undefined;
    configError = String(error?.message || error);
  }
  const pullRequest = snapshot?.evidence?.pullRequest || {};
  const commits = Array.isArray(pullRequest.commits) ? pullRequest.commits : [];
  const headCommit = commits.length ? commits[commits.length - 1] : null;
  return evaluateLocalCiEvidence({
    config,
    repo,
    pr: snapshot?.pr,
    headSha: snapshot?.headOid,
    baseSha:
      snapshot?.evidence?.captureBoundary?.baseOid ||
      snapshot?.evidence?.baseHealth?.baseOid ||
      null,
    headCommittedAt:
      headCommit?.committedDate || headCommit?.committedAt || null,
    configError,
    ...options,
  });
}
