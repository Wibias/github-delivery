#!/usr/bin/env node
/**
 * List advisory CODEOWNERS matches for files changed on a PR.
 * Usage: node scripts/codeowners-for-pr.mjs OWNER/REPO PR_NUMBER
 * Requires: gh auth
 */
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import {
  ownersForPath,
  parseCodeowners,
} from "./lib/codeowners.mjs";
import { collectPaginated } from "./lib/github-pagination.mjs";

const [repo, prRaw] = process.argv.slice(2);
const pr = Number(prRaw);
if (!repo || !repo.includes("/") || !Number.isInteger(pr) || pr <= 0) {
  console.error("Usage: node scripts/codeowners-for-pr.mjs OWNER/REPO PR_NUMBER");
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
    body: result.stdout || "",
    error: (result.stderr || result.stdout || "").trim() || null,
  };
}

function ghJson(args) {
  const result = ghOk(args);
  if (!result.ok) throw new Error(result.error || "gh failed");
  return JSON.parse(result.body || "null");
}

function fetchCodeowners(ref) {
  const candidates = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];
  for (const path of candidates) {
    const result = ghOk([
      "api",
      `repos/${owner}/${name}/contents/${path}?ref=${encodeURIComponent(ref)}`,
    ]);
    if (!result.ok) continue;
    try {
      const meta = JSON.parse(result.body);
      if (meta?.content) {
        return {
          path,
          text: Buffer.from(meta.content, "base64").toString("utf8"),
        };
      }
    } catch {
      // Try the next supported location.
    }
  }
  return null;
}

try {
  const prView = ghJson([
    "pr",
    "view",
    String(pr),
    "--repo",
    repo,
    "--json",
    "baseRefName,headRefOid,reviewRequests,reviewDecision,url",
  ]);

  const filesFetch = collectPaginated({
    label: "pull-request files",
    fetchPage(page) {
      return ghOk([
        "api",
        `repos/${owner}/${name}/pulls/${pr}/files?per_page=100&page=${page}`,
      ]);
    },
  });

  let codeownersErrors = [];
  let codeownersErrorsReadable = false;
  const errorsResult = ghOk([
    "api",
    `repos/${owner}/${name}/codeowners/errors?ref=${encodeURIComponent(prView.baseRefName)}`,
  ]);
  if (errorsResult.ok) {
    try {
      codeownersErrors = JSON.parse(errorsResult.body)?.errors || [];
      codeownersErrorsReadable = true;
    } catch {
      codeownersErrorsReadable = false;
    }
  }

  const source = fetchCodeowners(prView.baseRefName);
  const rules = source ? parseCodeowners(source.text) : [];
  const files = {};
  const ownersUnion = new Set();
  for (const row of filesFetch.rows) {
    const path = row?.filename;
    if (!path) continue;
    const match = ownersForPath(rules, path);
    files[path] = match;
    for (const ownerName of match?.owners || []) ownersUnion.add(ownerName);
  }

  const output = {
    schemaVersion: 1,
    repo,
    pr,
    base: prView.baseRefName,
    headOid: prView.headRefOid,
    url: prView.url,
    complete: filesFetch.complete,
    authority: "advisory",
    authorityNote:
      "GitHub reviewDecision remains authoritative for enforced CODEOWNERS approval.",
    codeownersPath: source?.path || null,
    codeownersErrors,
    changedFiles: Object.keys(files).length,
    ownersUnion: [...ownersUnion],
    reviewRequests: (prView.reviewRequests || []).map(
      (request) => request?.login || request?.slug || request?.name || null,
    ).filter(Boolean),
    reviewDecision: prView.reviewDecision || null,
    files,
    sources: {
      changedFilesReadable: filesFetch.readable,
      changedFilesComplete: filesFetch.complete,
      changedFilesPages: filesFetch.pages,
      changedFilesError: filesFetch.error,
      codeownersErrorsReadable,
    },
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exitCode = output.complete ? 0 : 2;
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
