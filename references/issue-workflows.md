<!-- policy-modules:start -->
Policy modules:
- policy-kernel
- mutation
- issues
- evidence
<!-- policy-modules:end -->

# Issue Workflow Procedures

Detailed procedures for each workflow type. Read the relevant section when executing that workflow.

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
5. Present the breakdown for approval before publishing unless the user already requested direct issue creation.
6. Publish with this shape:
   - Parent
   - What to build
   - Acceptance criteria
   - Blocked by

Prefer many thin slices over a few broad issues.

## Triage Workflow

Use when reviewing incoming issues, labels, state, or readiness for agents.

Roles:

- Category: `bug` or `enhancement`
- State: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, or `wontfix`

Every triaged issue should have exactly one category and one state. If state roles conflict, stop and ask the maintainer.

For a specific issue:

1. Read body, comments, labels, reporter, dates, and prior triage notes.
2. Check `.out-of-scope/*.md` for similar rejected enhancements.
3. Explore relevant code and docs enough to understand domain behavior.
4. For bugs, attempt reproduction before grilling the reporter.
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
4. Decide whether this is one issue or a breakdown.
5. File issues directly when the report is clear enough AND issue-creation authority exists.
6. Print issue URLs and ask whether there is another issue.

Issue body for a single QA bug:

```markdown
## What happened

## What I expected

## Steps to reproduce

## Additional context
```

For breakdowns, create blocker issues first and mark dependency relationships.

## Refactor Plan Workflow

Use when the user wants a refactor request, refactoring RFC, or tiny-commit plan.

1. Ask for the problem and any solution ideas if not already clear.
2. Verify the current codebase shape before accepting assumptions.
3. Present alternative approaches and tradeoffs.
4. Interview until scope, non-scope, and testing expectations are explicit.
5. Inspect existing test coverage in the area.
6. Break the refactor into the smallest commits that leave the codebase working.
7. Publish a refactor issue with:
   - Problem Statement
   - Solution
   - Commits
   - Decision Document
   - Testing Decisions
   - Out of Scope
   - Further Notes
