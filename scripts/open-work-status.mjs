#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { extractWorkItemReferences } from "./lib/work-item-reference.mjs";

function sh(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 50 * 1024 * 1024,
    }).trim();
  } catch (error) {
    const stderr = error.stderr?.toString?.().trim();
    throw new Error(stderr || error.message || `open_work_command_failed:${command}`);
  }
}

function sameRepo(left, right) {
  return String(left || "").toLowerCase() === String(right || "").toLowerCase();
}

function repoName(row, side) {
  return row?.[`${side}RepoFullName`] ?? row?.[side]?.repo?.full_name ?? row?.[side]?.repo?.nameWithOwner ?? null;
}

function issueRepositoryName(issue) {
  const explicit = issue?.repository?.nameWithOwner ?? issue?.repository?.full_name;
  if (explicit) return String(explicit);
  const owner = issue?.repository?.owner?.login;
  const name = issue?.repository?.name;
  return owner && name ? `${owner}/${name}` : null;
}

function normalizeClosingIssueLinks(value) {
  if (!Array.isArray(value)) return { links: [], complete: false };
  const links = [];
  let complete = true;
  for (const issue of value) {
    const number = Number(issue?.number);
    const repository = issueRepositoryName(issue);
    if (!Number.isInteger(number) || number <= 0 || !repository) {
      complete = false;
      continue;
    }
    links.push({
      number,
      url: issue?.url ? String(issue.url) : null,
      repository,
    });
  }
  return { links, complete };
}

export function normalizeOpenPullPages(payload, repoFullName) {
  if (!Array.isArray(payload)) throw new Error("open_work_pr_pages_invalid");
  const pages = payload.length && payload.every(Array.isArray) ? payload : [payload];
  const rows = [];

  for (const page of pages) {
    if (!Array.isArray(page)) throw new Error("open_work_pr_page_invalid");
    for (const raw of page) {
      const number = Number(raw?.number);
      const title = raw?.title;
      const url = raw?.html_url ?? raw?.url;
      const authorLogin = raw?.authorLogin ?? raw?.user?.login;
      const headRefName = raw?.headRefName ?? raw?.head?.ref;
      const headRefOid = raw?.headRefOid ?? raw?.head?.sha;
      const headRepoFullName = repoName(raw, "head");
      const baseRefName = raw?.baseRefName ?? raw?.base?.ref;
      const targetRepoFullName = raw?.targetRepoFullName ?? repoName(raw, "base");
      const rawMergeableState = raw?.mergeableState ?? raw?.mergeable_state ?? null;
      const issueLinksProvided = Array.isArray(raw?.issueLinks);

      if (
        !Number.isInteger(number) || number <= 0 || !title || !url || !authorLogin ||
        !headRefName || !headRefOid || !headRepoFullName || !baseRefName || !targetRepoFullName
      ) {
        throw new Error("open_work_pr_row_incomplete");
      }
      if (!sameRepo(targetRepoFullName, repoFullName)) {
        throw new Error(`open_work_repo_mismatch:${targetRepoFullName}`);
      }

      rows.push({
        number,
        title: String(title),
        url: String(url),
        authorLogin: String(authorLogin),
        body: String(raw?.body || ""),
        isDraft: raw?.isDraft === true || raw?.draft === true,
        updatedAt: raw?.updatedAt ?? raw?.updated_at ?? null,
        mergeableState: String(rawMergeableState ?? "unknown").toLowerCase(),
        mergeStateComplete: raw?.mergeStateComplete === true || rawMergeableState !== null,
        headRefName: String(headRefName),
        headRefOid: String(headRefOid),
        headRepoFullName: String(headRepoFullName),
        baseRefName: String(baseRefName),
        targetRepoFullName: String(targetRepoFullName),
        issueLinks: issueLinksProvided ? raw.issueLinks : [],
        issueLinksComplete: raw?.issueLinksComplete === true || issueLinksProvided,
        externalLinks: Array.isArray(raw?.externalLinks) ? raw.externalLinks : [],
      });
    }
  }
  return rows;
}

function nextActionFor(row) {
  if (row.isDraft) return "draft";
  if (["dirty", "conflicting"].includes(row.mergeableState)) return "resolve-conflicts";
  if (row.mergeableState === "behind") return "update-base";
  return null;
}

function workItemFor(repository, row) {
  if (row.issueLinksComplete === false) {
    return {
      state: "unknown",
      candidates: [],
      reason: "github-issue-link-evidence-unavailable",
    };
  }
  return extractWorkItemReferences({
    repository,
    issueLinks: row.issueLinks,
    externalLinks: row.externalLinks,
    headRefName: row.headRefName,
    title: row.title,
    body: row.body,
  });
}

export function buildOpenWorkStatus({ repository, authenticatedLogin, rows = [] } = {}) {
  if (!repository) throw new Error("open_work_repo_identity_missing");
  if (!authenticatedLogin) throw new Error("open_work_authenticated_login_missing");
  const login = String(authenticatedLogin).toLowerCase();

  const pullRequests = rows
    .filter((row) => String(row.authorLogin || "").toLowerCase() === login)
    .sort((a, b) => b.number - a.number)
    .map((row) => ({
      number: row.number,
      title: row.title,
      url: row.url,
      headRefName: row.headRefName,
      headRefOid: row.headRefOid,
      baseRefName: row.baseRefName,
      isDraft: row.isDraft,
      updatedAt: row.updatedAt,
      nextAction: nextActionFor(row),
      nextActionEvidenceComplete: row.isDraft || row.mergeStateComplete !== false,
      workItem: workItemFor(repository, row),
    }));

  return {
    repository: String(repository),
    authenticatedLogin: String(authenticatedLogin),
    complete: true,
    pullRequests,
  };
}

export function listAllOpenPullRequests(repoFullName, runner = sh) {
  const raw = runner("gh", [
    "api",
    `repos/${repoFullName}/pulls?state=open&per_page=100`,
    "--paginate",
    "--slurp",
  ]);
  let payload;
  try {
    payload = JSON.parse(raw || "[]");
  } catch {
    throw new Error("open_work_pr_pages_invalid_json");
  }
  return normalizeOpenPullPages(payload, repoFullName);
}

function enrichPullRequestDetails(repoFullName, rows, runner = sh) {
  return rows.map((row) => {
    let payload;
    try {
      const raw = runner("gh", [
        "pr",
        "view",
        String(row.number),
        "--repo",
        repoFullName,
        "--json",
        "closingIssuesReferences,mergeStateStatus",
      ]);
      payload = JSON.parse(raw || "{}");
    } catch {
      return {
        ...row,
        issueLinksComplete: false,
        mergeStateComplete: false,
      };
    }
    const issueEvidence = normalizeClosingIssueLinks(payload?.closingIssuesReferences);
    const mergeStateStatus = typeof payload?.mergeStateStatus === "string"
      ? payload.mergeStateStatus.trim()
      : "";
    return {
      ...row,
      issueLinks: issueEvidence.links,
      issueLinksComplete: issueEvidence.complete,
      mergeableState: mergeStateStatus ? mergeStateStatus.toLowerCase() : "unknown",
      mergeStateComplete: Boolean(mergeStateStatus),
    };
  });
}

export function collectOpenWorkStatus(runner = sh) {
  const repoFullName = runner("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  if (!repoFullName) throw new Error("open_work_repo_identity_missing");
  const authenticatedLogin = runner("gh", ["api", "user", "--jq", ".login"]);
  if (!authenticatedLogin) throw new Error("open_work_authenticated_login_missing");

  const allRows = listAllOpenPullRequests(repoFullName, runner);
  const authoredRows = allRows.filter(
    (row) => row.authorLogin.toLowerCase() === authenticatedLogin.toLowerCase(),
  );
  const enriched = enrichPullRequestDetails(repoFullName, authoredRows, runner);
  return buildOpenWorkStatus({ repository: repoFullName, authenticatedLogin, rows: enriched });
}

export function main() {
  process.stdout.write(`${JSON.stringify(collectOpenWorkStatus(), null, 2)}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(String(error?.message || error));
    process.exitCode = 2;
  }
}
