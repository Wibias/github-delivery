# Research issue

**Trigger:** “Research internally and online on issue #N…”, “is this already fixed on dev?”

## Goal

Determine whether issue `#N` still needs work, is obsolete, or is already fixed on a development branch but not yet on the release/default branch.

## Steps

1. Fetch issue `#N` (title, body, labels, linked PRs, timeline).
2. **Internal:** search the repo, related PRs, commits, and branches for fixes or duplicates.
3. **Online:** search docs, upstream issues, release notes, or known advisories when relevant.
4. Compare branches: is a fix present on the development branch but missing from the release/default branch?
5. Report a clear verdict:

| Verdict | Meaning |
|---|---|
| Needs fix | Still reproducible / unimplemented on the relevant release line |
| Fixed on dev, not released | Fix exists on development branch only; cite PR/commit |
| Already fixed / shipped | Present on release/default (or closed with the fix landed) |
| Duplicate / not actionable | Point to the canonical issue or reason |

Include evidence: links, SHAs, PR numbers, brief repro notes if you tested.

## Done when

- Verdict is explicit
- Evidence is cited
- No PR opened unless the user also asked to create one
