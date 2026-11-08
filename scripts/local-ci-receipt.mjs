#!/usr/bin/env node
/**
 * Record a user-scoped local CI evidence receipt for one exact PR head.
 *
 * Usage:
 *   node scripts/local-ci-receipt.mjs OWNER/REPO PR --log FILE --command CMD
 *     [--command CMD ...] [--scope SCOPE ...] [--exit-code N] [--waiver TEXT]
 *     [--started-at ISO] [--replace]
 *
 * The receipt binds the repository, PR number, exact head and base SHA,
 * command/suite scope, exit codes, runner host, tool versions, timestamps and
 * a hash of the complete log file. It is written outside the repository, so
 * repository content cannot forge it.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { arch, hostname, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { boundedSpawnSync } from "./lib/subprocess-policy.mjs";
import {
  canonicalReceiptHash,
  localEvidenceReceiptPath,
  LOCAL_CI_RECEIPT_KIND,
  LOCAL_CI_RECEIPT_SCHEMA_VERSION,
} from "./lib/local-ci-evidence.mjs";
import {
  readUserConfig,
  resolveCiEvidenceMode,
} from "./lib/user-config.mjs";

const USAGE =
  "Usage: node scripts/local-ci-receipt.mjs OWNER/REPO PR --log FILE --command CMD [--command CMD ...] [--scope SCOPE ...] [--exit-code N] [--waiver TEXT] [--started-at ISO] [--replace]";

function parseArgs(argv) {
  const positionals = [];
  const options = {
    log: null,
    commands: [],
    scopes: [],
    exitCode: 0,
    waiver: null,
    startedAt: null,
    replace: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--log") options.log = argv[++index];
    else if (value === "--command") options.commands.push(argv[++index]);
    else if (value === "--scope") options.scopes.push(argv[++index]);
    else if (value === "--exit-code") options.exitCode = Number(argv[++index]);
    else if (value === "--waiver") options.waiver = argv[++index];
    else if (value === "--started-at") options.startedAt = argv[++index];
    else if (value === "--replace") options.replace = true;
    else positionals.push(value);
  }
  const [repo, prRaw] = positionals;
  const pr = Number(prRaw);
  if (
    positionals.length !== 2 ||
    !repo?.includes("/") ||
    !Number.isInteger(pr) ||
    pr <= 0 ||
    !options.log ||
    !options.commands.length ||
    options.commands.some((command) => !command || !String(command).trim()) ||
    !Number.isInteger(options.exitCode)
  ) {
    throw new Error(USAGE);
  }
  if (
    options.scopes.length &&
    options.scopes.length !== 1 &&
    options.scopes.length !== options.commands.length
  ) {
    throw new Error("--scope must appear once or once per --command");
  }
  return { repo, pr, ...options };
}

function run(command, args) {
  const result = boundedSpawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    body: String(result.stdout || "").trim(),
    error: String(result.stderr || result.stdout || "").trim(),
  };
}

function toolVersion(label, command, args) {
  const result = run(command, args);
  const value = (result.body || result.error).split(/\r?\n/)[0].trim();
  if (!result.ok || !value) {
    throw new Error(`tool_version_unavailable:${label}`);
  }
  return value;
}

export function npmVersion(execPath = process.env.ComSpec || "cmd.exe") {
  if (process.platform === "win32") {
    return toolVersion("npm", execPath, ["/d", "/s", "/c", "npm --version"]);
  }
  return toolVersion("npm", "npm", ["--version"]);
}

export function recordLocalCiReceipt(argv, dependencies = {}) {
  const args = parseArgs(argv);
  const readConfig = dependencies.readUserConfig || readUserConfig;
  const now = dependencies.now || new Date();
  const logPath = resolve(args.log);
  const config = readConfig().config;
  const mode = resolveCiEvidenceMode({ config, repo: args.repo });
  if (mode.mode !== "local") {
    throw new Error("local_evidence_mode_not_configured");
  }
  const waiver = String(args.waiver || mode.waiver || "").trim();
  if (waiver !== String(mode.waiver || "").trim()) {
    throw new Error("local_evidence_waiver_mismatch");
  }
  if (!existsSync(logPath)) throw new Error("local_evidence_log_missing");
  const logInfo = statSync(logPath);
  if (!logInfo.isFile() || logInfo.size <= 0) {
    throw new Error("local_evidence_log_empty");
  }

  const prInfo = run("gh", [
    "pr",
    "view",
    String(args.pr),
    "--repo",
    args.repo,
    "--json",
    "number,headRefOid,baseRefOid,commits",
  ]);
  if (!prInfo.ok) {
    throw new Error(`local_evidence_pr_unreadable:${prInfo.error || "gh failed"}`);
  }
  const pr = JSON.parse(prInfo.body);
  const headSha = String(pr.headRefOid || "").toLowerCase();
  const baseSha = String(pr.baseRefOid || "").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(headSha) || !/^[0-9a-f]{40}$/.test(baseSha)) {
    throw new Error("local_evidence_pr_shas_unavailable");
  }
  const commits = Array.isArray(pr.commits) ? pr.commits : [];
  const headCommit = commits.length ? commits[commits.length - 1] : null;
  const headCommittedAt =
    headCommit?.committedDate || headCommit?.committedAt || null;

  const commands = args.commands.map((command, index) => ({
    command: String(command).trim(),
    scope: String(
      args.scopes.length === 1
        ? args.scopes[0]
        : args.scopes[index] || "targeted",
    ).trim(),
    exitCode: args.exitCode,
  }));
  if (commands.some((entry) => !entry.scope)) {
    throw new Error("local_evidence_scope_missing");
  }

  const body = {
    schemaVersion: LOCAL_CI_RECEIPT_SCHEMA_VERSION,
    kind: LOCAL_CI_RECEIPT_KIND,
    repository: args.repo,
    pullRequest: args.pr,
    headSha,
    baseSha,
    headCommittedAt,
    recordedAt: now.toISOString(),
    startedAt: args.startedAt
      ? new Date(args.startedAt).toISOString()
      : new Date(logInfo.mtimeMs).toISOString(),
    completedAt: new Date(logInfo.mtimeMs).toISOString(),
    waiver,
    exitCode: args.exitCode,
    commands,
    runner: {
      host: hostname(),
      platform: platform(),
      release: release(),
      arch: arch(),
    },
    tools: {
      node: process.version,
      npm: dependencies.npmVersion
        ? dependencies.npmVersion()
        : npmVersion(),
      git: toolVersion("git", "git", ["--version"]),
    },
    log: {
      path: logPath,
      sha256: createHash("sha256")
        .update(readFileSync(logPath))
        .digest("hex"),
      bytes: logInfo.size,
    },
  };
  const receipt = { ...body, receiptHash: canonicalReceiptHash(body) };
  const receiptPath =
    dependencies.receiptPath ||
    localEvidenceReceiptPath({
      repo: args.repo,
      pr: args.pr,
      headSha,
    });
  if (existsSync(receiptPath) && !args.replace) {
    throw new Error("local_evidence_receipt_exists");
  }
  mkdirSync(dirname(receiptPath), { recursive: true });
  const tempPath = `${receiptPath}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(tempPath, receiptPath);
  return {
    schemaVersion: 1,
    kind: "github-delivery/local-ci-receipt-recording",
    repository: args.repo,
    pullRequest: args.pr,
    headSha,
    baseSha,
    waiver,
    receiptPath,
    receiptHash: receipt.receiptHash,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = recordLocalCiReceipt(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 2;
  }
}
