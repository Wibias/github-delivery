<!-- policy-modules:start -->
Policy modules:
- policy-kernel
- mutation
- issues
- evidence
<!-- policy-modules:end -->

# Issue Workflow Procedures

Detailed procedures for each workflow type. Read the relevant section when executing that workflow.

When a workflow below publishes durable issue or PRD prose authored by `github-delivery`, apply `references/prose-quality.md` before publication. Preserve exact quoted user wording, repository identifiers, evidence states, required issue structure, and any policy-mandated text. Readability cleanup must not strengthen uncertain evidence or hide an unresolved product decision.

## Issue publication action contract

Use `create_issue` for a direct user request to create, file, or open a new GitHub issue. This is the canonical lifecycle action for ordinary issue publication.

Use `create_follow_up_issue` only when the requested object is specifically a follow-up issue produced from an existing review/finding/workflow context. It is a distinct semantic action, not a fallback for direct issue creation and not evidence that `create_issue` is unsupported.

The public mutation dispatch boundary is `scripts/github-mutate.mjs` → `scripts/lib/github-mutation-router.mjs`. Do not infer supported actions by inspecting only one backend broker. Routine issue work should use the documented workflow, action registry, router, and dry-run/execute entrypoint; inspect broker internals only when that public path fails or the task is explicitly debugging/auditing `github-delivery` itself.

## PRD Workflow

Use when the user asks for a PRD or wants the current conversation turned into product requirements.

1. Explore enough of the repo to understand current behavior and vocabulary.
2. Identify major modules or contracts likely to change.
3. Ask only for high-impact missing decisions, especially test scope.
4. Produce and publish a PRD with:
   - Problem Statement
   - Solution
   - User Stories
   - Implementation Decisions
   - Testing Decisions
   - Out of Scope
   - Further Notes

Do not over-interview if the conversation already contains enough context.

## Issue Breakdown Workflow

Use when converting a plan, PRD, spec, or issue into implementation tickets.

1. Gather source material from the conversation, provided issue, or linked document.
2. Break work into tracer-bullet vertical slices.
3. Each slice must be independently verifiable and preferably demoable.
4. Mark slices as `AFK` when an agent can implement them without human judgment; mark `HITL` when a design or product decision is still needed.
5. When one broad internal migration cannot be expressed as independently green vertical slices, apply the expand-contract branch in `references/change-execution.md`: expand the new form beside the old, migrate real blast-radius partitions, then contract only after every migration batch and residual check is complete.
6. Present the breakdown for approval before publishing unless the user already requested direct issue creation.
7. Publish direct requested issues with `create_issue`. Use `create_follow_up_issue` only for an explicitly identified follow-up issue from the governing workflow.
8. Publish with this shape:
   - Parent
   - What to build
   - Acceptance criteria
   - Blocked by

Prefer many thin slices over a few broad issues, except when a real wide-refactor dependency requires the bounded expand-contract sequence above.

## Triage Workflow

Use when reviewing incoming issues, labels, state, or readiness for agents.

Roles:

- Category: `bug` or `enhancement`
- State: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, or `wontfix`

Every triaged issue should have exactly one category and one state. If state roles conflict, stop and ask the maintainer.

### Triage inbox

When the user asks what needs attention, what should be triaged next, or for the current triage queue, return a read-only inbox before mutating anything. Build these buckets, oldest first inside each bucket:

1. **Untriaged:** open issues with no canonical triage state yet.
2. **Needs triage:** open issues currently in `needs-triage`.
3. **Needs-info with new reporter activity:** open `needs-info` issues where the reporter added relevant information after the last maintainer/[GD] triage note.

Show counts and a one-line evidence-backed summary per item. Do not treat maintainer/bot chatter as reporter activity. Do not move labels merely because an item appears in the inbox; the user may pick an item or ask for a batch triage separately.

For a specific issue:

1. Read body, comments, labels, reporter, dates, and prior triage notes.
2. Check `.out-of-scope/*.md` for similar rejected enhancements.
3. Explore relevant code and docs enough to understand domain behavior.
4. For bugs, attempt reproduction before grilling the reporter. When runtime reproduction is feasible, use `references/runtime-evidence.md`: bind observations to the exact commit/environment and never treat `not-reproduced` as proof the issue is fixed.
5. Recommend category/state with reasoning.
6. For `ready-for-agent`, post an agent brief. Read `references/agent-brief.md` first.
7. For rejected enhancements, read `references/out-of-scope.md`, update `.out-of-scope/`, comment, and close only after maintainer confirmation.

Needs-info notes should capture established facts and ask specific actionable questions.

## QA Intake Workflow

Use when the user reports bugs conversationally or asks for a QA session.

For each issue:

1. Let the user describe the problem.
2. Ask at most 2-3 short clarifying questions about expected behavior, actual behavior, reproduction, and consistency.
3. Explore the relevant codebase area in the background to learn domain terms and behavior boundaries.
4. When a runtime attempt is feasible and useful, follow `references/runtime-evidence.md`. Capture the exact head/environment, trigger, expected vs actual behavior, and evidence. Do not block a clear issue report merely because reproduction is unavailable.
5. Decide whether this is one issue or a breakdown.
6. File issues directly with `create_issue` when the report is clear enough AND issue-creation authority exists.
7. Print issue URLs and ask whether there is another issue.

Issue body for a single QA bug:

```markdown
## What happened

## What I expected

## Steps to reproduce

## Runtime evidence
Reproduced / not reproduced / not attempted / blocked or inconclusive, with exact environment/head when available.

## Additional context
```

For breakdowns, create blocker issues first and mark dependency relationships.

## Refactor Plan Workflow

Use when the user wants a refactor request, refactoring RFC, or tiny-commit plan.

1. Ask for the problem and any solution ideas if not already clear.
2. Verify the current codebase shape before accepting assumptions.
3. Apply `references/minimal-solution.md` before inventing new architecture: check whether the goal is best met by deletion, existing repository capability, standard library/runtime, native platform behavior, an already-installed dependency, or only then custom structure. Present genuinely credible alternatives and tradeoffs; do not manufacture options for ceremony.
4. Interview until scope, non-scope, and testing expectations are explicit.
5. Inspect existing test coverage in the area.
6. If the refactor migrates an internal API/shape, repeats a deterministic edit across many targets, or has dependent migration phases, apply `references/change-execution.md`. Inventory the old/new contract and callers, decide whether compatibility is real, select direct vs expand-contract vs bounded non-shippable migration, decide whether a script/codemod/generator lowers change risk, and define the checks that make each migration unit verifiable.
7. Break the refactor into the smallest meaningful units that leave a checkable state. Prefer units that keep the codebase working; when a temporary non-shippable intermediate state is unavoidable, bound it explicitly and do not present it as merge-ready.
8. Publish a refactor issue with:
   - Problem Statement
   - Solution
   - Commits / Verifiable Units
   - Decision Document
   - Testing Decisions
   - Migration Surface and Compatibility Decision (when `references/change-execution.md` applies)
   - Migration Strategy (direct | expand-contract | bounded non-shippable, when `references/change-execution.md` applies)
   - Lever Decision and Completion Proof (when `references/change-execution.md` applies)
   - Out of Scope
   - Further Notes

The triage-inbox shape is adapted from Matt Pocock's MIT-licensed `triage` skill. GitHub Delivery keeps it read-only until the user selects work and retains its own issue-state, evidence, mutation-authority, and publication rules.
