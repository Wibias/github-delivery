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

Use this workflow for an **existing GitHub PR stack**: inspect topology, review or update a member safely, restack after parent/trunk drift, retarget bases, recover a rewritten branch, or merge bottom-up.

`github-delivery` remains authoritative for the complete GitHub lifecycle. This reference owns stack topology and stack-specific mutation order. The selected PR workflow still owns review depth, issue linkage, comments, CI, security, readiness, merge thanks, and close-out.

Do not use this workflow to split one oversized branch into a new stack; route that request to `split-to-prs`.

## Core model

Treat open GitHub PR base links as the authoritative graph:

```text
PR headRefName → PR baseRefName
```

A stack is a connected component where at least one open PR targets another open PR's head branch. Prefer this graph over branch-name conventions or local ancestry.

- **bottom** — lowest open PR, normally targeting trunk;
- **parent** — immediate PR base of a child;
- **child** — open PR whose base is another open PR's head;
- **top** — highest descendant in a linear chain;
- **restack** — rewrite a child onto its intended parent/trunk;
- **retarget** — change the GitHub PR base without rewriting its head.

## Mutation authority

Inspection is read-only. Restacking, retargeting, recovering, body edits, rewritten pushes, closing empty PRs, or merging are mutations.

Before the first mutation:

1. select the active mutation mode;
2. verify the requested action is authorized;
3. show the complete bounded plan;
4. identify every branch/PR that may change;
5. identify expected remote tips and backup refs;
6. stop if any required branch is unwritable.

Never mutate trunk or another protected/shared branch. Never use bare `--force`; only the narrow `--force-with-lease` exception in `SKILL.md` is allowed.

## 1. State preflight

Use PowerShell only.

```powershell
gh auth status
git status --short --branch
gh repo view --json nameWithOwner,defaultBranchRef `
  --jq '{repo:.nameWithOwner,trunk:.defaultBranchRef.name}'
```

Also verify repository identity, clean-enough Git state, detected default branch, named PR/branch existence, and writability of every branch that may be rewritten.

Enable conflict memory before restacking:

```powershell
git config rerere.enabled true
git config rerere.autoUpdate false
```

Resolve the push remote once. Never hardcode `origin`:

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

Use `$PushRemote` for every fetch, remote-tip read, ancestry check, rebase remote-tracking ref, lease, and push.

Before review/readiness/merge, each child's current parent remote tip must be an ancestor:

```powershell
git fetch $PushRemote
git merge-base --is-ancestor "$PushRemote/$Parent" "refs/heads/$Child"
if ($LASTEXITCODE -ne 0) { throw "Child $Child is behind its parent; restack first." }
```

A stale child diff is never review-ready or merge-ready.

<!-- assertion-anchors -->
<!-- assertion: state-check-first -->
<!-- assertion: rerere-conflict-memory -->
<!-- assertion: remote-pushdefault-resolution -->
<!-- assertion: needs-rebase-ancestor-preflight -->
<!-- /assertion-anchors -->

If authentication, repository identity, branch writability, or Git state is unclear, stop with the exact blocker. Do not claim stack state from partial evidence.

## 2. Inspect the complete stack

Use the bundled inspector as the source of truth:

```powershell
node "<github-delivery>/scripts/inspect-stack.mjs" --all
```

For a named head:

```powershell
node "<github-delivery>/scripts/inspect-stack.mjs" --head $HeadBranch
```

The inspector collects **all** open PRs with paginated GitHub REST calls (`gh api --paginate --slurp`). It does not use a fixed `gh pr list --limit N` ceiling. It fails closed on malformed/incomplete rows, duplicate open head branches, cycles, or unreadable GitHub evidence and prints `Topology complete: yes` only after full pagination succeeds.

Do not reconstruct an authoritative mutation graph from a capped PR list. If complete pagination cannot be proven, topology is unknown and mutation stops.

The graph uses:

```text
headRefName → baseRefName
```

Select the connected component by user-named PR/head, then current branch when it is an open PR head, otherwise inspect all non-trivial stacks.

Reject/report ambiguous shapes:

- cycles;
- duplicate open PR heads;
- branching stacks when the requested operation assumes a linear chain;
- bottom PR base that is neither trunk nor an explicitly intended integration branch.

Report bottom→top order, shape, depth, and merge order. Depth above three is allowed but should trigger a risk warning.

<!-- assertion-anchors -->
<!-- assertion: gh-pr-list-used -->
<!-- assertion: inspect-script-or-algorithm -->
<!-- assertion: stack-tree-reported -->
<!-- assertion: no-mutation -->
<!-- /assertion-anchors -->

### Review view

For each PR:

- review its primary delta against its immediate parent;
- verify cumulative repository state at that layer;
- distinguish defects introduced by the layer from inherited defects;
- never declare a child ready while required parent state is unknown, blocked, stale, or changing.

### Layer-ownership editing

Each change belongs to the layer that owns the path. Before editing, check out the owning branch. Never put a lower-layer fix on the top branch. After editing a lower layer, rebase every descendant bottom→top and return to the previous branch.

<!-- assertion-anchors -->
<!-- assertion: layer-ownership-edit -->
<!-- /assertion-anchors -->

## 3. Choose the stack action

### Inspect only

No mutation. Return complete topology, merge order, bases, drift, and blockers.

### Parent gained commits

Restack descendants bottom→top.

### Trunk moved

Restack the bottom onto current trunk, then each child onto its updated parent.

### Parent merged

Check GitHub's child retarget result. If needed, broker the base retarget to the intended surviving base, then restack before treating the new diff as authoritative.

### Recover a bad restack

Prefer a recorded backup ref. Use reflog or destructive reset only with explicit user approval when no verified backup exists.

### Merge stack

Merge bottom-up. Never merge a middle/top PR while its base still represents an unlanded parent unless the user explicitly requests a supported non-trunk integration outcome.

## 4. Restack plan and backups

Record current local/remote tips before every rewrite:

```powershell
$Timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
git fetch $PushRemote
$LocalTip = git rev-parse "refs/heads/$Child"
$RemoteTip = git ls-remote --heads $PushRemote "refs/heads/$Child" |
  ForEach-Object { ($_ -split '\s+')[0] }
if (-not $RemoteTip) { throw "Remote branch $PushRemote/$Child was not found." }
$BackupRef = "refs/backup/$Child-$Timestamp"
git update-ref $BackupRef $LocalTip
```

Plan must identify branch, old local tip, expected remote tip, new parent, backup ref, and lease-pinned push. Create a backup ref for every branch whose tip may be lost.

## 5. Restack execution

Fetch immediately before each rewrite:

```powershell
git fetch $PushRemote
git switch $Child
git rebase "$PushRemote/$Parent"
```

On conflicts, load `references/resolve-conflicts.md`. Resolve only the current layer's intended concern. If resolution would pull in a sibling concern or change layer ownership, stop.

After rebase:

1. inspect the complete diff against intended parent;
2. run focused and required checks;
3. re-read the remote tip;
4. refuse if it changed;
5. push with an exact lease only.

```powershell
$CurrentRemoteTip = git ls-remote --heads $PushRemote "refs/heads/$Child" |
  ForEach-Object { ($_ -split '\s+')[0] }
if ($CurrentRemoteTip -ne $RemoteTip) { throw "Remote tip changed; refusing rewritten push." }
git push --force-with-lease="refs/heads/$Child`:$RemoteTip" `
  $PushRemote "HEAD:refs/heads/$Child"
```

Stop on lease rejection. Never weaken the lease.

## 6. Retarget a PR base

Read current head/base first:

```powershell
gh pr view $ChildNumber --json number,headRefOid,headRefName,baseRefName,url
```

A PR base edit is a GitHub mutation. Never use a raw mutating `gh api` call from this workflow. Build a broker request:

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

Plan/execute through `scripts/github-mutate.mjs`. The broker verifies head and old base, binds both bases into trusted authority when enabled, verifies the new base, and recognizes an already-applied retry.

A retarget changes comparison topology; it does not prove the branch is restacked. Revalidate the diff and ancestry.

## 7. Parent merge and branch-deletion risk

Before merging a parent:

1. identify immediate children from the **complete** topology;
2. determine surviving bases;
3. retarget where required before branch deletion;
4. merge only through the normal merge workflow;
5. confirm merged state;
6. rerun the complete inspector;
7. repair child bases/restack;
8. rerun all gates on rewritten children.

Never retarget blindly; the diff is provisional until restacking completes.

## 8. Merge bottom-up

For each level:

1. verify bottom target is trunk/intended integration branch;
2. obtain a current authoritative `ship-gate.mjs` ready result;
3. merge through `references/merge-pr.md`;
4. confirm merged state;
5. rerun complete stack inspection;
6. verify/repair immediate child bases;
7. restack next child;
8. treat rewritten head as new review evidence;
9. rerun review, CI, approval, policy, and ship gates;
10. continue only when the child independently reaches the normal merge bar.

Never reuse a parent's readiness result for a child.

### Merge queue

When a merge queue is enforced, a contiguous lower portion may be queued together only when repository policy and `merge_group` coverage support that operation. Each PR still needs its own current-head readiness before enqueue. After queue landing, rerun complete topology inspection and revalidate surviving children.

<!-- assertion-anchors -->
<!-- assertion: queue-all-or-nothing-lower-stack -->
<!-- /assertion-anchors -->

### Empty child after parent lands

Verify intended behavior, tests, migrations, docs, metadata, and generated outputs are already represented on the surviving base. Close the empty PR only with explicit authority.

## 9. Review hygiene

- Avoid unnecessary restacks during an active review round.
- Do not request broad final review while a required parent is materially changing unless review is explicitly layer-only.
- After every rewritten head, re-check stale approvals and last-push policy.
- Never claim GitHub auto-retarget alone makes a child correct.
- Green CI alone never makes the whole stack ready.

## 10. Recovery

Prefer a verified backup ref:

```powershell
git update-ref "refs/heads/$Child" $BackupRef
git switch $Child
```

If no backup exists, inspect reflog. Do not hard-reset or push a recovered tip without explicit approval and a verified target SHA. Never recover by rewriting trunk. Re-inspect the complete stack after recovery.

## 11. Optional stack links in PR bodies

Only when requested or established by repository convention, maintain a deterministic marked block. Editing PR bodies requires mutation authority; replace the existing block and read it back after mutation.

## 12. Validation after every mutation

After restack, retarget, recovery, body update, or parent merge:

1. rerun the complete paginated stack inspector;
2. verify every remaining `baseRefName`;
3. verify every rewritten remote head equals the pushed SHA;
4. inspect each affected diff against intended parent;
5. rerun focused/required checks;
6. re-check threads, approvals, CODEOWNERS, draft state, and policies;
7. run authoritative `ship-gate.mjs` for every PR whose readiness is asserted;
8. report divergence instead of claiming success.

## Output

```text
Action:      <inspect | review | restack | retarget | recover | merge>
Stack:       #a → #b → #c
Shape:       <linear | branching | ambiguous>
Changed:     <branches / PR bases / bodies / none>
Backups:     <refs created or none>
Heads:       <old → new SHAs>
Verification:<complete topology, checks, gates>
Blockers:    <exact unresolved evidence>
Next:        <next safe stack action>
```
