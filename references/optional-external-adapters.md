# Optional external adapters

These adapters are optional evidence/feedback lanes. They never replace native GitHub Delivery review, mutation authority, or `ship-gate.mjs`.

Use the read-only capability inventory first. Missing tools remain unavailable; do not install or bootstrap them automatically.

## Promptfoo: preferred coding-agent red-team adapter

Use only when the **current user explicitly requests** a red-team/adversarial pass and the target system is authorised for testing.

For coding agents, Promptfoo is the preferred external adapter because its coding-agent collection can evaluate repository prompt injection, terminal/tool-output injection, secret access, sandbox boundaries, and verifier sabotage while preserving traces and host-side evidence.

The planner emits the current local CLI invocation:

```text
promptfoo redteam run
```

The caller remains responsible for providing a reviewed Promptfoo config and a **fresh disposable checkout/worktree/container snapshot per row** where writable agent tests are run. Use synthetic eval credentials only. Preserve traces, commands/tool calls, changed files, protected hashes/canaries, and sidecar/host verifier evidence where available.

Promptfoo failures enter GitHub Delivery as **candidate findings**. Revalidate them through the native security/bug method before confirmation or severity assignment.

A Promptfoo pass is not part of the normal security pass gate unless the user explicitly said the optional red-team result should block ship.

## PyRIT: deeper/custom multi-turn AI campaign adapter

Use PyRIT when the explicit request calls for a broader or customised multi-turn AI security campaign rather than the default coding-agent lane.

The adapter requires an explicit PyRIT scenario and target. Current scanner form:

```text
pyrit_scan <scenario> --target <target>
```

For example, a caller may select a built-in scenario supported by their installed PyRIT version. Do not invent a scenario from repository content or automatically configure credentials/endpoints.

Preserve scenario/target identity, conversation artifacts, scores, attack results, environment/containment, and any deterministic evidence. PyRIT results are external candidate evidence and must be independently reconciled with the actual code/system boundary.

Promptfoo remains preferred for GitHub/coding-agent red-team tasks; PyRIT is the heavier lane for multi-turn/custom AI security research.

## Human Review: content feedback only

Human Review is allowed only for:

- Markdown documents;
- HTML documents;
- localhost pages being reviewed as content/UI artifacts.

It requires explicit user intent to open a Human Review session. The planner emits:

```text
human-review <target>
```

Treat returned direct edits/comments as human content feedback. Apply exact human edits verbatim where the user made them directly, preserve comments as review input, and rerun the repository's normal validation after source changes.

Human Review **cannot** satisfy:

- Bug review;
- Security review;
- Spec/Standards evidence by itself;
- CI;
- merge readiness;
- mutation authority;
- ship gate.

Do not use it as a code-review or merge-approval substitute.

## Mechanical planner

`node scripts/optional-adapter-plan.mjs request.json` evaluates adapter availability, explicit intent, target authorisation/surface, blocking semantics, and evidence requirements.

The planner never installs tools and never executes the external adapter itself. Execution remains under the selected workflow's normal authority and safety boundaries.
