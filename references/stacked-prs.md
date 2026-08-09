<!-- policy-modules:start -->
Policy modules:
- policy-kernel
- mutation
- evidence
- git
- ci
- reviews
- publication
- stacks
<!-- policy-modules:end -->

# Stacked Pull Requests

Use this workflow for an **existing GitHub PR stack**: inspect its topology,
review or update a member safely, restack after parent or trunk drift, retarget
bases, recover a rewritten branch, or merge the stack bottom-up.

`github-delivery` remains authoritative for the complete GitHub lifecycle.
This reference owns only stack topology and stack-specific mutation order. The
selected PR workflow still owns review depth, issue linkage, comments, CI,
security, readiness, merge thanks, and close-out.

Do not use this workflow to split one oversized branch into a new stack; route
that request to `split-to-prs`.

## Core model

Treat open GitHub PR base links as the authoritative graph:

```text
PR headRefName → PR baseRefName
```

A stack is a connected component in which at least one open PR targets another
open PR's head branch.

Prefer this graph over branch-name conventions or local ancestry. It remains
usable after a parent squash-merge rewrites commits or deletes its branch.

Terminology:

- **bottom** — the lowest open PR, normally targeting repository trunk;
- **parent** — the immediate PR base of a child;
- **child** — an open PR whose base is another open PR's head;
- **top** — the highest descendant in a linear chain;
- **restack** — rewrite a child so its commits sit on its current intended
  parent or trunk;
- **retarget** — change a PR's GitHub base branch without rewriting its head.

## Mutation authority

Inspection is read-only.

Restacking, retargeting, recovering, editing stack body blocks, pushing rewritten
heads, closing empty PRs, or merging are external or history mutations. Before
the first mutation:

1. select the active `github-delivery` mutation mode;
2. verify the requested action is authorized;
3. show the complete bounded plan;
4. identify every branch and PR that may change;
5. identify all expected remote tips and local backup refs;
6. stop if a required branch is unwritable.

Never mutate repository trunk or another protected/shared branch.

Never use bare `--force`. A stack history rewrite may use
`--force-with-lease` only under the narrow exception defined in
`github-delivery/SKILL.md`.

## 1. State preflight

Use PowerShell only.

```powershell
gh auth status
git status --short --branch
gh repo view --json nameWithOwner,defaultBranchRef `
  --jq '{repo:.nameWithOwner,trunk:.defaultBranchRef.name}'
```

Also verify:

- current directory is the intended repository;
- GitHub remote and canonical repository are unambiguous;
- no unrelated dirty worktree or index changes exist;
- the default branch is detected rather than assumed;
- the named PR or branch exists;
- every branch that may be rewritten is local or can be created safely from its
  expected remote tip.

**Conflict memory (rerere):** before any restack work, enable
`git config rerere.enabled true` (and prefer `rerere.autoUpdate false` so you
review each replay). Rebase conflicts are then remembered across cascading
restacks, so a conflict resolved on one child does not need re-resolving on
every branch above it.

**Remote resolution (multi-remote safety):** never hardcode `origin`. Resolve
the push remote once:

```powershell
$PushRemote = git config --get remote.pushDefault
if (-not $PushRemote) {
  $Remotes = git remote
  if (($Remotes -split "\s+").Count -ne 1) {
    throw "Multiple remotes and no remote.pushDefault; set it or pass --remote explicitly."
  }
  $PushRemote = $Remotes
}
```

Use `$PushRemote` everywhere a push/fetch target is needed (restack push, branch
cleanup, backport). On a single-remote repo this is `origin`; on multi-remote
repos it refuses to guess.

**needsRebase preflight (before review / readiness / merge):** for each child,
the parent's current remote tip must be an **ancestor** of the child:

```powershell
git merge-base --is-ancestor "origin/$Parent" "refs/heads/$Child"
if ($LASTEXITCODE -ne 0) { throw "Child $Child is behind its parent; restack first." }
```

A child whose parent tip is not an ancestor shows a stale diff (parent commits
missing) — never review, declare ready, or merge it in that state.

<!-- assertion-anchors -->
<!-- assertion: state-check-first -->
<!-- assertion: rerere-conflict-memory -->
<!-- assertion: remote-pushdefault-resolution -->
<!-- assertion: needs-rebase-ancestor-preflight -->
<!-- /assertion-anchors -->

If authentication, repository identity, branch writability, or Git state is
unclear, stop with the exact blocker. Do not claim stack state from partial
evidence.

## 2. Inspect the complete stack

Read all open PRs:

```powershell
$Pulls = gh pr list --state open --limit 100 `
  --json number,title,headRefName,baseRefName,url,isDraft,headRefOid
```

Build a graph where every PR is:

```text
headRefName → baseRefName
```

Select the connected component in this order:

1. user-named PR number or head branch;
2. current branch, when it is an open PR head;
3. otherwise every non-trivial connected stack.

Walk upward while the current PR base is another open PR head. Then walk
downward through every open child.

Reject or explicitly report ambiguous shapes:

- one child with multiple apparent parents;
- cycles;
- duplicate open PR heads;
- branching stacks when the requested operation assumes a linear chain;
- a bottom PR whose base is neither trunk nor an explicitly intended integration
  branch.

Report:

```text
Stack (bottom → top)
  #N  head → base  title  URL
Merge order: #bottom → … → #top
Shape: linear | branching | ambiguous
Depth: N
```

Depth above three is not forbidden, but warn that review and restack risk rises.
Recommend landing the lower portion first when that reduces risk.

<!-- assertion-anchors -->
<!-- assertion: gh-pr-list-used -->
<!-- assertion: inspect-script-or-algorithm -->
<!-- assertion: stack-tree-reported -->
<!-- assertion: no-mutation -->
<!-- /assertion-anchors -->

### Review view

For each PR in the stack:

- review its primary delta against its immediate parent;
- verify the cumulative repository state at that level;
- distinguish defects introduced by this PR from defects inherited from a
  parent;
- do not demand that every child independently include parent changes in its
  own diff;
- do not declare a child merge-ready while its required parent state is
  unknown, blocked, or changing.

### Layer-ownership editing

Each change belongs to the **layer that owns the path**. Before editing:

1. Check out the branch whose PR should carry the change — run
   `gh stack view` / inspect `git log --all -- <path>` when ownership is
   unclear.
2. Never commit a lower layer's concern on the current top branch; the diff
   would be attributed to the wrong PR layer.
3. After editing the owner, rebase every branch above it (bottom → top) so the
   upstack diffs still contain only their own delta, then return to the
   previous branch.

<!-- assertion-anchors -->
<!-- assertion: layer-ownership-edit -->
<!-- /assertion-anchors -->

## 3. Choose the stack action

### Inspect only

Do not mutate. Return topology, merge order, current bases, drift, and blockers.

### Parent gained commits

Restack descendants bottom → top so each child rebases onto the updated immediate
parent.

### Trunk moved while the stack remains open

Restack the bottom PR onto current trunk first, then each child onto its updated
parent.

### Parent merged into trunk

Check whether GitHub retargeted each immediate child. If not, retarget it to the
intended surviving base. Then restack the child against that base before treating
its new diff as authoritative.

### Recover a bad restack

Restore only the affected non-trunk branch from a recorded backup ref. Use
reflog or destructive reset only with explicit user approval when no verified
backup exists.

### Merge stack

Merge bottom-up, one PR at a time. Never merge a middle or top PR while its base
still represents an unlanded parent unless the user explicitly requests a
non-trunk integration outcome and the repository policy supports it.

## 4. Restack plan and backups

Before rewriting, record the current local and remote tips.

Example:

```powershell
$Child = "feature/child"
$Parent = "feature/parent"
$Timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()

git fetch origin

$LocalTip = git rev-parse "refs/heads/$Child"
$RemoteTip = git ls-remote --heads origin "refs/heads/$Child" |
  ForEach-Object { ($_ -split '\s+')[0] }

if (-not $RemoteTip) {
  throw "Remote branch origin/$Child was not found."
}

$BackupRef = "refs/backup/$Child-$Timestamp"
git update-ref $BackupRef $LocalTip
```

The mutation plan must list:

```text
Branch:       <child>
Old local:    <sha>
Expected remote: <sha>
New parent:   <parent or trunk>
Backup:       refs/backup/<branch>-<timestamp>
Push:         force-with-lease only
```

Create a backup ref for every branch whose tip may be lost.

## 5. Restack execution

Fetch immediately before each rewrite.

```powershell
git fetch origin
git switch $Child
git rebase "origin/$Parent"
```

When conflicts occur, load `references/resolve-conflicts.md`. Resolve only the
current PR's intended concern. If a valid resolution requires silently pulling
in a sibling PR or changing the stack's conceptual ownership, stop: the stack
shape or slice boundaries are wrong.

After the rebase:

1. inspect the complete rewritten diff against the intended parent;
2. run focused checks;
3. run all checks required by the owning PR workflow;
4. confirm the remote branch still equals the recorded expected tip;
5. push only with lease.

```powershell
$CurrentRemoteTip = git ls-remote --heads origin "refs/heads/$Child" |
  ForEach-Object { ($_ -split '\s+')[0] }

if ($CurrentRemoteTip -ne $RemoteTip) {
  throw "Remote tip changed; refusing rewritten push."
}

git push --force-with-lease="refs/heads/$Child`:$RemoteTip" `
  origin "HEAD:refs/heads/$Child"
```

Stop on lease rejection. Never retry by weakening the lease or using bare
`--force`.

For a linear stack, repeat bottom → top.

## 6. Retarget a PR base

First inspect and record the current PR head and base:

```powershell
gh pr view $ChildNumber --json number,headRefOid,headRefName,baseRefName,url
```

A PR base edit is a network-visible GitHub mutation. Do not call a raw mutating
`gh api` command from this workflow. Build an exact broker request instead:

```json
{
  "schemaVersion": 1,
  "action": "retarget_pr",
  "mutationMode": "maintainer",
  "explicitInstruction": true,
  "repo": "OWNER/REPO",
  "pr": 123,
  "expectedHead": "CURRENT_HEAD_SHA",
  "expectedBase": "feature/parent",
  "newBase": "main"
}
```

Plan and execute that request only through `scripts/github-mutate.mjs`. The
broker verifies the current head and old base before the PATCH, binds both bases
to trusted authority when enabled, reads `baseRefName` back afterwards, and
recognizes a safe retry when the requested target base is already applied.

A base edit changes GitHub comparison topology; it does not prove that the
child branch has been restacked correctly. Compare the resulting diff and
restack when needed.

## 7. Parent merge and branch-deletion risk

Before merging a parent, determine whether repository settings may delete its
head branch and whether GitHub will preserve or close children.

When deletion could strand children:

1. identify immediate open children;
2. determine their intended surviving base;
3. retarget them before the parent branch disappears when required;
4. merge the parent only through the normal `github-delivery` merge workflow;
5. confirm the parent is actually merged, not merely queued;
6. re-inspect child bases;
7. restack the next child onto the surviving base;
8. rerun its full required gates.

Do not retarget blindly. A premature base change may temporarily expose parent
commits in the child diff; treat the diff as provisional until restacking is
complete.

## 8. Merge bottom-up

For every level:

1. Verify the current bottom PR targets trunk or the explicitly intended
   integration branch.
2. Run its ordinary `github-delivery` merge-ready workflow and obtain a current
   authoritative `ship-gate.mjs` result.
3. Merge through `references/merge-pr.md`, including thanks and linked-issue
   handling.
4. Confirm GitHub reports the PR as merged.
5. Re-inspect the complete remaining stack.
6. Verify or repair immediate child bases.
7. Restack the next child onto its new intended base.
8. Treat the child's rewritten head as new review evidence.
9. Rerun required review, CI, approval, policy, and ship gates.
10. Continue only when the next child independently reaches the normal merge
    bar.

Never reuse a parent's readiness result for its child.

### Merge queue: all-or-nothing lower-stack merge

When the base branch uses a **merge queue**, merging the contiguous lower
portion of the stack as one all-or-nothing queue entry is a valid alternative
to strict one-at-a-time bottom-up merging:

- Check queue policy first (`scripts/pr-policy-gate.mjs` / `merge_group`
  coverage). If the queue is enforced, enqueue the lower PRs together; the
  queue processes them in order and each `merge_group` run revalidates the
  combined head.
- The merge-ready bar still applies **per PR before enqueue**: each PR in the
  lower set needs its own current-head `ship-gate.mjs` `ready`, own reviews,
  and clean threads — queuing does not waive readiness.
- After the queue lands the set, re-inspect the remaining stack, restack the
  next child onto the surviving base, and rerun its gates (same as bottom-up).
- Never enqueue a child whose parent is not yet in the same queue entry unless
  the queue's merge order provably keeps the parent ahead (the child would
  otherwise evaluate against an unlanded base).

<!-- assertion-anchors -->
<!-- assertion: queue-all-or-nothing-lower-stack -->
<!-- /assertion-anchors -->

### Empty child after parent lands

If the child's authoritative diff becomes empty:

- verify the intended behavior is already present on the surviving base;
- verify no unique tests, migrations, docs, metadata, or generated outputs were
  lost;
- close the PR only with explicit authority;
- leave a concise explanation and preserve linked-issue correctness.

## 9. Review hygiene

- Avoid unnecessary restacks during an active review round because rewritten
  commits invalidate anchors and may stale approvals.
- Do not request a broad final review of PR K while required parent PR K-1 is
  still materially changing, unless the reviewer is explicitly reviewing only
  K's delta.
- After every rewritten head, re-check stale approvals and last-push policy.
- Never claim that GitHub's auto-retarget alone makes the child correct.
- Never call the whole stack ready merely because every current CI check is
  green; each node must satisfy the normal shipping bar on its current head.

## 10. Recovery

Prefer a verified backup ref:

```powershell
$Child = "feature/child"
$BackupRef = "refs/backup/$Child-<timestamp>"

git update-ref "refs/heads/$Child" $BackupRef
git switch $Child
```

Inspect the restored diff and expected remote tip before any push.

If no backup exists, inspect:

```powershell
git reflog show $Child
```

Do not run `git reset --hard` or push a recovered tip without explicit user
approval and a verified target SHA.

Never recover by rewriting trunk.

After recovery, re-inspect the stack and rerun the owning workflow's checks.

## 11. Optional stack links in PR bodies

Only when requested or already established by repository convention, maintain a
deterministic block between markers:

```markdown
<!-- stack:links:start -->

### Stack

- [x] #101
- [ ] #102
- [ ] **#103** 👈 current
<!-- stack:links:end -->
```

- checked = merged;
- bold plus arrow = current PR;
- replace the existing marked block instead of appending duplicates;
- editing PR bodies requires mutation authority;
- read back every edited body.

## 12. Validation after every mutation

After restack, retarget, recovery, body update, or parent merge:

1. fetch current remote state;
2. rebuild the complete PR-base graph;
3. verify every remaining `baseRefName`;
4. verify every rewritten remote head equals the pushed SHA;
5. inspect each affected diff against its intended parent;
6. rerun focused and required repository checks;
7. re-check review threads, approvals, CODEOWNERS, draft state, and policies;
8. run the authoritative `ship-gate.mjs` for every PR whose readiness is being
   asserted;
9. report divergence instead of claiming success.

## Output

```text
Action:      <inspect | review | restack | retarget | recover | merge>
Stack:       #a → #b → #c
Shape:       <linear | branching | ambiguous>
Changed:     <branches / PR bases / bodies / none>
Backups:     <refs created or none>
Heads:       <old → new SHAs>
Verification:<re-inspect, checks, gates>
Blockers:    <exact unresolved evidence>
Next:        <next safe stack action>
```
