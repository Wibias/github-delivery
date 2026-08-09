#!/usr/bin/env node
/**
 * Inspect every open GitHub PR and print stack tree(s) from baseRef links.
 * Usage:
 *   node scripts/inspect-stack.mjs
 *   node scripts/inspect-stack.mjs --head <branch>
 *   node scripts/inspect-stack.mjs --all
 * Default focus: current git branch if it is a PR head; else all non-trivial stacks.
 */
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

function sh(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 50 * 1024 * 1024,
      ...opts,
    }).trim();
  } catch (error) {
    const stderr = error.stderr?.toString?.() || error.message;
    const code = error.status ?? 1;
    throw new Error(
      `Command failed (${cmd} ${args.join(" ")}): exit ${code}${stderr ? `\n${stderr.trim()}` : ""}`,
    );
  }
}

function parseArgs(argv) {
  const out = { head: null, all: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--all") out.all = true;
    else if (a === "--head") {
      out.head = argv[++i];
      if (!out.head) throw new Error("Missing value for --head");
    } else if (a === "--help" || a === "-h") {
      out.help = true;
    } else {
      throw new Error(`Unknown arg: ${a}`);
    }
  }
  return out;
}

function currentBranch() {
  try {
    return execFileSync("git", ["branch", "--show-current"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim() || null;
  } catch {
    return null;
  }
}

export function normalizePullPages(payload) {
  if (!Array.isArray(payload)) throw new Error("stack_pr_pages_invalid");
  const pages = payload.length && payload.every(Array.isArray) ? payload : [payload];
  const prs = [];
  for (const page of pages) {
    if (!Array.isArray(page)) throw new Error("stack_pr_page_invalid");
    for (const row of page) {
      const number = Number(row?.number);
      const headRefName = row?.headRefName ?? row?.head?.ref;
      const baseRefName = row?.baseRefName ?? row?.base?.ref;
      if (!Number.isInteger(number) || number <= 0 || !headRefName || !baseRefName) {
        throw new Error("stack_pr_row_incomplete");
      }
      prs.push({
        number,
        title: String(row?.title || ""),
        headRefName: String(headRefName),
        baseRefName: String(baseRefName),
        url: String(row?.url ?? row?.html_url ?? ""),
        isDraft: row?.isDraft === true || row?.draft === true,
        headRefOid: row?.headRefOid ?? row?.head?.sha ?? null,
      });
    }
  }
  const numbers = new Set();
  for (const pr of prs) {
    if (numbers.has(pr.number)) throw new Error(`stack_pr_duplicate_number:${pr.number}`);
    numbers.add(pr.number);
  }
  return prs;
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
    throw new Error("stack_pr_pages_invalid_json");
  }
  return normalizePullPages(payload);
}

export function buildGraph(prs) {
  const byHead = new Map();
  const children = new Map();
  for (const pr of prs) {
    if (byHead.has(pr.headRefName)) {
      throw new Error(`stack_duplicate_open_head:${pr.headRefName}`);
    }
    byHead.set(pr.headRefName, pr);
    if (!children.has(pr.baseRefName)) children.set(pr.baseRefName, []);
    children.get(pr.baseRefName).push(pr);
  }
  return { byHead, children };
}

export function stackRoots(prs, trunkNames, children) {
  const heads = new Set(prs.map((p) => p.headRefName));
  return prs.filter((pr) => {
    const baseIsTrunk = trunkNames.has(pr.baseRefName);
    const baseIsOpenHead = heads.has(pr.baseRefName);
    return baseIsTrunk || !baseIsOpenHead;
  });
}

export function walkStack(root, children, acc = [], path = new Set()) {
  if (path.has(root.number)) throw new Error(`stack_cycle:${root.number}`);
  const nextPath = new Set(path).add(root.number);
  acc.push(root);
  const kids = children.get(root.headRefName) || [];
  for (const kid of kids) walkStack(kid, children, acc, nextPath);
  return acc;
}

export function connectedFromHead(head, byHead, children) {
  const start = byHead.get(head);
  if (!start) return null;
  let cursor = start;
  const seen = new Set();
  while (byHead.has(cursor.baseRefName)) {
    if (seen.has(cursor.number)) throw new Error(`stack_cycle:${cursor.number}`);
    seen.add(cursor.number);
    cursor = byHead.get(cursor.baseRefName);
  }
  return walkStack(cursor, children);
}

function printStack(label, stack, trunk) {
  console.log(`Stack: ${label}`);
  console.log("  (bottom → top)");
  for (const pr of stack) {
    const draft = pr.isDraft ? " [draft]" : "";
    console.log(
      `  #${pr.number}  ${pr.headRefName} → ${pr.baseRefName}  ${pr.title}${draft}`,
    );
    console.log(`    ${pr.url}`);
  }
  const depth = stack.length;
  const order = stack.map((p) => `#${p.number}`).join(" → ");
  console.log(`Merge order: ${order || "(empty)"}`);
  if (depth > 3) {
    console.log(
      `Warning: depth ${depth} > 3 — land the bottom half before continuing.`,
    );
  }
  const bottom = stack[0];
  if (bottom && !trunk.has(bottom.baseRefName)) {
    console.log(
      `Note: bottom base '${bottom.baseRefName}' is not trunk; confirm this is intentional.`,
    );
  }
  console.log("");
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log("Usage: node scripts/inspect-stack.mjs [--head <branch>] [--all]");
    return 0;
  }

  sh("gh", ["auth", "status"]);
  sh("git", ["rev-parse", "--is-inside-work-tree"]);
  const repoJson = sh("gh", [
    "repo",
    "view",
    "--json",
    "nameWithOwner,defaultBranchRef",
  ]);
  let repo;
  try {
    repo = JSON.parse(repoJson);
  } catch {
    throw new Error("stack_repo_metadata_invalid_json");
  }
  const repoFullName = repo?.nameWithOwner;
  if (!repoFullName) throw new Error("stack_repo_identity_missing");
  const trunkName = repo.defaultBranchRef?.name;
  if (!trunkName) throw new Error("stack_default_branch_missing");
  const trunk = new Set([trunkName]);

  const prs = listAllOpenPullRequests(repoFullName);
  const { byHead, children } = buildGraph(prs);

  console.log(`Repo: ${repoFullName}`);
  console.log(`Trunk: ${trunkName}`);
  console.log(`Open PRs: ${prs.length}`);
  console.log("Topology complete: yes (paginated all open PRs)");
  console.log(`Evidence temp hint: ${tmpdir()}`);
  console.log("");

  if (prs.length === 0) {
    console.log("No open PRs. Nothing to stack.");
    return 0;
  }

  let focusHead = args.head;
  if (!args.all && !focusHead) {
    const cur = currentBranch();
    if (cur && byHead.has(cur)) focusHead = cur;
  }

  if (focusHead) {
    const stack = connectedFromHead(focusHead, byHead, children);
    if (!stack) throw new Error(`No open PR with head '${focusHead}'. Use --all or pass a PR head branch.`);
    printStack(`focused on ${focusHead}`, stack, trunk);
    return 0;
  }

  const roots = stackRoots(prs, trunk, children);
  const stacks = roots.map((root) => walkStack(root, children));
  const multi = stacks.filter((stack) => stack.length >= 2);
  const singles = stacks.filter((stack) => stack.length === 1);

  if (multi.length === 0) {
    console.log("No multi-PR stacks detected (no open PR bases another open PR).");
    console.log("Standalone open PRs (not a stack):");
    for (const stack of singles) {
      const pr = stack[0];
      console.log(
        `  #${pr.number}  ${pr.headRefName} → ${pr.baseRefName}  ${pr.title}  ${pr.url}`,
      );
    }
    return 0;
  }

  for (const stack of multi) {
    const label = stack.map((p) => `#${p.number}`).join(" → ");
    printStack(label, stack, trunk);
  }
  if (singles.length) {
    console.log(`Also ${singles.length} standalone open PR(s) not in a multi-PR stack.`);
  }
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
