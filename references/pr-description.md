# PR description policy

Load this policy when opening a PR and again before declaring it merge-ready.

## Goal

The PR body is a durable, evidence-grounded explanation of the **final head**. A reviewer should understand what changed, why it matters, and how it was validated without reconstructing the story from commits.

Be concise, but never vague. The body is not a changelog, implementation diary, or file-by-file narration. After the evidence and required sections are correct, apply `references/prose-quality.md`. That cleanup may improve wording, but it must preserve exact evidence states, GitHub syntax, required template fields, security redaction, user-confirmed wording, and existing media unless exact removal was explicitly authorized.

## Sources of truth

Build and maintain the description from, in order:

1. the linked issue and its acceptance criteria;
2. the actual diff on the current head;
3. completed validation and required checks;
4. material review findings, risks, exclusions, and known limitations.

Commit messages are navigation aids only. Do not treat planned work, branch names, or commit summaries as proof of what the PR finally does.

## Required body

### Summary

Use one to three bullets that describe the resulting behavior and impact.

- State what changed and why it matters.
- Name important boundaries or compatibility effects when material.
- Mention files or symbols only when they help a reviewer understand scope or risk.
- Do not narrate every file, commit, refactor step, or review iteration.
- Do not make broad claims such as “fully fixes”, “all cases”, or “no regressions” unless the evidence supports them.

After publication, re-read the live GitHub body. Real newlines must survive; literal `\\n` sequences, collapsed `## Heading - bullet` lines, and escaped checklists are a failed publication, not a formatting preference.

### Validation

List the exact commands, tests, or named checks that actually ran and their result.

- Use concrete evidence: `` `command` — pass `` or `` `check-name` — green ``.
- Distinguish focused tests, full suites, local checks, and remote required CI.
- If something was not run, say **not run** and explain why.
- Never report expected, queued, skipped, or unrelated historical checks as successful validation of the current head.

### Issue link

Preserve the canonical same-repository closing reference, for example:

```markdown
Fixes #N
```

Do not lose or weaken the closing reference while editing the body.

### Optional sections

Add these only when they carry useful information:

- **Review notes:** non-obvious choices, risk areas, migration details, or where review attention is most valuable.
- **Limitations:** known gaps, explicit exclusions, deferred follow-ups, or validation that could not be completed.

## Default template

```markdown
## Summary

- <resulting behavior and impact>
- <important boundary or compatibility note, when material>

## Validation

- `<command or check>` — pass

## Review notes

- <optional non-obvious decision or review focus>

## Limitations

- <optional known gap or explicit exclusion>

Fixes #N
```

Remove empty optional sections instead of leaving placeholder text.

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

1. read the issue and acceptance criteria;
2. inspect the actual diff and current head;
3. collect the validation that has already completed;
4. write the body from that evidence, describing the current result rather than the intended plan.
5. for new CLI/API surfaces, include wiring trace + operator smoke + test-honesty evidence, plus input-shape/evidence-semantics and malformed-input checks where the PR adds parsers/scanners/persistence (shared **Proactive contract verification**); do not claim verified when only unit tests on happy paths passed.

A good body explains the change at the behavioral level. It does not copy the issue, enumerate commits, or inflate routine implementation details into unsupported outcomes.

## Final-head reconciliation

Before posting merge-ready evidence:

1. re-read the final diff and linked issue;
2. compare every material body claim with the final head;
3. update the Summary for scope or behavior changed by follow-up commits;
4. update Validation to reflect what ran on the final head;
5. add or remove Review notes and Limitations as the evidence changed;
6. confirm the canonical closing reference still resolves to the intended issue;
7. preserve every existing protected media identity unless its exact removal is explicitly authorized.

If review fixes or later commits materially changed behavior, scope, validation, risk, or limitations, update the PR body. A materially stale or misleading description blocks a merge-ready claim. A body rewrite that would silently discard existing media is also blocked.

## Rewrite these anti-patterns

- “Various improvements” or “fixes the issue” without concrete behavior.
- One bullet per changed file or commit.
- Future-tense claims for work already implemented.
- Validation claims for commands or checks that did not run on the relevant head.
- A copied issue description with no explanation of the implemented result.
- Stale scope, test, or limitation claims after review-driven changes.
- Body rewrites that accidentally remove screenshots, uploads, or videos.
- Walls of implementation detail that hide the user or developer impact.
