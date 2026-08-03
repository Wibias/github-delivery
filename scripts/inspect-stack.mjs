#!/usr/bin/env node
/**
 * Inspect open GitHub PRs and print stack tree(s) from baseRef links.
 * Usage:
 *   node scripts/inspect-stack.mjs
 *   node scripts/inspect-stack.mjs --head <branch>
 *   node scripts/inspect-stack.mjs --all
 * Default focus: current git branch if it is a PR head; else all non-trivial stacks.
 */
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

function sh(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...opts,
    }).trim();
  } catch (error) {
    const stderr = error.stderr?.toString?.() || error.message;
    const code = error.status ?? 1;
    console.error(`Command failed (${cmd} ${args.join(' ')}): exit ${code}`);
    if (stderr) console.error(stderr.trim());
    process.exit(code || 1);
  }
}

function parseArgs(argv) {
  const out = { head: null, all: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--all') out.all = true;
    else if (a === '--head') {
      out.head = argv[++i];
      if (!out.head) {
        console.error('Missing value for --head');
        process.exit(2);
      }
    } else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/inspect-stack.mjs [--head <branch>] [--all]');
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

function currentBranch() {
  try {
    return execFileSync('git', ['branch', '--show-current'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim() || null;
  } catch {
    return null;
  }
}

function buildGraph(prs) {
  const byHead = new Map();
  for (const pr of prs) byHead.set(pr.headRefName, pr);
  const children = new Map(); // base branch -> child PRs whose base is that branch
  for (const pr of prs) {
    if (!children.has(pr.baseRefName)) children.set(pr.baseRefName, []);
    children.get(pr.baseRefName).push(pr);
  }
  return { byHead, children };
}

function stackRoots(prs, trunkNames, children) {
  const heads = new Set(prs.map((p) => p.headRefName));
  return prs.filter((pr) => {
    const baseIsTrunk = trunkNames.has(pr.baseRefName);
    const baseIsOpenHead = heads.has(pr.baseRefName);
    return baseIsTrunk || !baseIsOpenHead;
  });
}

function walkStack(root, children, acc = []) {
  acc.push(root);
  const kids = children.get(root.headRefName) || [];
  for (const kid of kids) walkStack(kid, children, acc);
  return acc;
}

function connectedFromHead(head, byHead, children) {
  const start = byHead.get(head);
  if (!start) return null;
  // Walk up to root via base links among open PR heads
  let cursor = start;
  const seen = new Set();
  while (byHead.has(cursor.baseRefName) && !seen.has(cursor.number)) {
    seen.add(cursor.number);
    cursor = byHead.get(cursor.baseRefName);
  }
  return walkStack(cursor, children);
}

function printStack(label, stack, trunk) {
  console.log(`Stack: ${label}`);
  console.log('  (bottom → top)');
  for (const pr of stack) {
    const draft = pr.isDraft ? ' [draft]' : '';
    console.log(
      `  #${pr.number}  ${pr.headRefName} → ${pr.baseRefName}  ${pr.title}${draft}`,
    );
    console.log(`    ${pr.url}`);
  }
  const depth = stack.length;
  const order = stack.map((p) => `#${p.number}`).join(' → ');
  console.log(`Merge order: ${order || '(empty)'}`);
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
  console.log('');
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  // State checks
  sh('gh', ['auth', 'status']);
  sh('git', ['rev-parse', '--is-inside-work-tree']);
  const repoJson = sh('gh', [
    'repo',
    'view',
    '--json',
    'nameWithOwner,defaultBranchRef',
  ]);
  const repo = JSON.parse(repoJson);
  const trunkName = repo.defaultBranchRef?.name || 'main';
  const trunk = new Set([trunkName, 'main', 'master', 'dev']);

  const prJson = sh('gh', [
    'pr',
    'list',
    '--state',
    'open',
    '--limit',
    '100',
    '--json',
    'number,title,headRefName,baseRefName,url,isDraft',
  ]);
  const prs = JSON.parse(prJson);
  const { byHead, children } = buildGraph(prs);

  console.log(`Repo: ${repo.nameWithOwner}`);
  console.log(`Trunk: ${trunkName}`);
  console.log(`Open PRs: ${prs.length}`);
  console.log(`Evidence temp hint: ${tmpdir()}`);
  console.log('');

  if (prs.length === 0) {
    console.log('No open PRs. Nothing to stack.');
    process.exit(0);
  }

  let focusHead = args.head;
  if (!args.all && !focusHead) {
    const cur = currentBranch();
    if (cur && byHead.has(cur)) focusHead = cur;
  }

  if (focusHead) {
    const stack = connectedFromHead(focusHead, byHead, children);
    if (!stack) {
      console.error(
        `No open PR with head '${focusHead}'. Use --all or pass a PR head branch.`,
      );
      process.exit(1);
    }
    printStack(`focused on ${focusHead}`, stack, trunk);
    process.exit(0);
  }

  // --all or no focused branch: print every stack with depth >= 1 that has a child link, plus solitary trunk PRs grouped
  const roots = stackRoots(prs, trunk, children);
  const stacks = roots.map((r) => walkStack(r, children));
  const multi = stacks.filter((s) => s.length >= 2);
  const singles = stacks.filter((s) => s.length === 1);

  if (multi.length === 0) {
    console.log('No multi-PR stacks detected (no open PR bases another open PR).');
    console.log('Standalone open PRs (not a stack):');
    for (const s of singles) {
      const pr = s[0];
      console.log(
        `  #${pr.number}  ${pr.headRefName} → ${pr.baseRefName}  ${pr.title}  ${pr.url}`,
      );
    }
    process.exit(0);
  }

  for (const stack of multi) {
    const label = stack.map((p) => `#${p.number}`).join(' → ');
    printStack(label, stack, trunk);
  }
  if (singles.length) {
    console.log(`Also ${singles.length} standalone open PR(s) not in a multi-PR stack.`);
  }
}

main();
