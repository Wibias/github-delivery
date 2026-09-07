# PR title and description policy

Load this policy when opening a PR and again before declaring it merge-ready.

## Goal

The title and body should let a reviewer understand the **final head** quickly: what problem or context motivated the change, what is different now, and why that result matters. They are durable review context, not a changelog, implementation diary, CI transcript, or file-by-file narration.

Be concise, but never vague. Evidence still has to exist in the workflow and merge-ready/full-review records; it does not have to be copied into the PR body unless it materially helps a reviewer understand the change. After the required facts are correct, apply `references/prose-quality.md`. That cleanup may improve wording, but it must preserve GitHub syntax, security redaction, user-confirmed wording, issue links, and existing media unless exact removal was explicitly authorized.

## Sources of truth

Build and maintain the title/body from, in order:

1. the linked issue and its acceptance criteria;
2. the actual diff on the current head;
3. completed validation and required checks;
4. material review findings, risks, exclusions, and known limitations.

Commit messages are navigation aids only. Do not treat planned work, branch names, or commit summaries as proof of what the PR finally does.

## Title

Before choosing or materially rewriting a title:

1. inspect the repository's title conventions;
2. look at recent merged PRs and Git history when available;
3. prefer a concise, human-readable title that names the resulting effect or why it matters;
4. use implementation mechanics only when they are themselves the reviewer-relevant result.

Do not manufacture a conventional-commit prefix when the repository does not use one consistently. Avoid branch names, TDD state, internal helper names, release-process notes, and other implementation history unless they are the clearest durable description of the outcome.

Examples:

- weaker: `feat(server): negotiate permessage-deflate on websocket connections`
- stronger when that is the demonstrated effect: `Cut websocket frame size with compression`

## Required body

### Context and result

Open with a short explanation of the problem or context, then describe the resulting behavior. The normal shape is one short paragraph followed by one to three bullets.

- State what changed and why it matters.
- Name important boundaries or compatibility effects when material.
- Mention files or symbols only when they help a reviewer understand scope or risk.
- Do not narrate every file, commit, refactor step, TDD transition, or review iteration.
- Do not make broad claims such as “fully fixes”, “all cases”, or “no regressions” unless the evidence supports them.

After publication, re-read the live GitHub body. Real newlines must survive; literal `\\n` sequences, collapsed headings/lists, and escaped checklists are a failed publication, not a formatting preference.

### Issue link

Preserve the canonical same-repository closing reference, for example:

```markdown
Fixes #N
```

Do not lose or weaken the closing reference while editing the body.

## Optional evidence and visual structure

Add supporting structure only when it communicates something a reviewer needs better than another paragraph.

Useful options include:

- a Mermaid diagram for a non-obvious flow or ownership boundary;
- a short code or usage snippet for a new API/CLI behavior;
- a before/after table with screenshots or video for visual changes;
- a before/after benchmark table when performance is a material claim;
- a short compatibility, risk, limitation, or review-focus note;
- **Review notes:** when a diff mixes core implementation with generated, lockfile, or other mechanical files, identify the core files a reviewer should read first and any non-obvious review focus;
- focused validation evidence when the evidence itself is unusual, disputed, or central to the claim.

Routine test commands, exact-head SHAs, CI check inventories, TDD RED/GREEN history, commit/file counts, and release-process narration belong in workflow evidence, merge-ready records, or full-review verdicts by default — not in the PR body.

For visual changes, prefer a compact before/after table using preserved uploaded media. For benchmarks, show the target-branch baseline and candidate result with the same measurement method; do not publish a one-sided number as a comparison.

## Default template

```markdown
<one short paragraph: problem/context and why the change matters>

- <resulting behavior or user/developer effect>
- <important boundary or compatibility note, when material>

Fixes #N
```

Remove the issue link when no canonical same-repository issue exists rather than inventing one. Add optional diagrams, snippets, media, benchmarks, risks, or limitations only when they improve the review.

## Media preservation invariant

Refreshing a PR body must not silently delete existing screenshots, videos, GitHub uploads, or other protected media.

Before `update_pr_body` executes, the mutation preflight re-reads the current PR head and body, verifies the exact expected head, extracts protected media identities from the observed and proposed bodies, and rejects any missing identity that was not explicitly approved for removal.

Protected identities include at minimum:

- Markdown images;
- Markdown links to recognized image/video or GitHub user-attachment URLs;
- HTML `img`, `video`, and `source` media URLs;
- GitHub `user-attachments` asset URLs.

Reordering media or rewriting surrounding text is allowed. Intentional deletion is narrow: the request must carry the exact media identities in `approvedMediaRemovals`. A boolean or broad “remove media” waiver is not supported.

The approved-removal set is part of the trusted `update_pr_body` authority scope. Changing that set after authority was issued changes the scope hash and requires new authority where configured.

If a requested body refresh would drop unapproved media, keep the existing body and surface the exact blocked identities instead of publishing the rewrite.

## Initial PR creation

Before opening the PR:

1. read the issue and acceptance criteria when one exists;
2. inspect the actual diff and current head;
3. collect the validation that has already completed for workflow evidence;
4. inspect repository title conventions, recent merged PRs, and Git history where available;
5. write the title/body from the current result rather than the intended plan;
6. for new CLI/API surfaces, keep wiring trace + operator smoke + test-honesty evidence, plus input-shape/evidence-semantics and malformed-input checks where the PR adds parsers/scanners/persistence (shared **Proactive contract verification**); do not claim verified when only unit tests on happy paths passed.

Routed initial PR creation remains **draft-only**. Better title/body writing does not authorize a ready-for-review transition or weaken any publication, mutation, or review gate.

A good body explains the change at the behavioral level. It does not copy the issue, enumerate commits, or inflate routine implementation details into unsupported outcomes.

## Final-head reconciliation

Before posting merge-ready evidence:

1. re-read the final diff and linked issue;
2. compare every material title/body claim with the final head;
3. refresh context/result wording when follow-up commits changed behavior or scope;
4. add, update, or remove optional diagrams, snippets, media, benchmark, risk, or limitation material when the evidence changed;
5. confirm the canonical closing reference still resolves to the intended issue;
6. preserve every existing protected media identity unless its exact removal is explicitly authorized;
7. keep validation evidence current in the merge-ready/full-review workflow even when routine validation is intentionally omitted from the PR body.

If review fixes or later commits materially changed behavior, scope, risk, or limitations, update the PR body. A materially stale or misleading description blocks a merge-ready claim. A body rewrite that would silently discard existing media is also blocked.

## Rewrite these anti-patterns

- “Various improvements” or “fixes the issue” without concrete behavior.
- A title that only names an internal mechanism when the resulting effect is clearer.
- One bullet per changed file or commit.
- Future-tense claims for work already implemented.
- Routine CI/test dumps, exact-head lines, or TDD history with no reviewer-facing purpose.
- Validation claims for commands or checks that did not run on the relevant head when validation is included.
- A copied issue description with no explanation of the implemented result.
- Stale scope, behavior, risk, or limitation claims after review-driven changes.
- Body rewrites that accidentally remove screenshots, uploads, or videos.
- Walls of implementation detail that hide the user or developer impact.
