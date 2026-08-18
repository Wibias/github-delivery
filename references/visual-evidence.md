# Visual evidence method

Use this method as a conditional review axis when `scripts/lib/visual-evidence.mjs` reports `required: true` for the current diff.

It is not a standalone mutation workflow. It supplies evidence to review/status/merge gates for UI-affecting changes.

## Triggering

Visual evidence is required for changes with concrete visual-surface signals, including:

- stylesheets;
- product visual assets;
- UI component/page/screen markup with visual or accessibility changes;
- equivalent rendered-surface changes detected by the planner.

Do not require product screenshots merely because arbitrary JavaScript/TypeScript changed or because a documentation image changed.

## Evidence contract

Evidence must be bound to the current PR head SHA. Accepted evidence kinds are:

- screenshot;
- video/recording;
- deterministic render artifact.

A text statement such as “looks good”, an old screenshot, or an artifact from another head is not visual evidence.

Capture the smallest useful set that proves the changed states. Include relevant responsive, error, empty, loading, focus, or interaction states when the diff materially affects them. Do not manufacture huge screenshot matrices for unrelated surfaces.

## Execution

1. Run the normal review-scope planner first.
2. If `visualEvidence.required` is false, do not load this method further.
3. Start the application or supported preview path using the repository's documented setup. Do not weaken authentication, security, or production configuration merely to obtain a screenshot.
4. Exercise the changed visual surface.
5. Record artifacts with the exact current `headRefOid`.
6. Validate them with `validateVisualEvidence(...)` before treating the axis as satisfied.
7. If the preview/render cannot be executed because a real dependency, credential, environment, or tool is unavailable, return a specific `blocked` reason. Do not convert the blocker into a clean verdict.

## Review use

Visual evidence answers only rendered-behaviour questions. It does not replace code review, accessibility reasoning, tests, security review, or current-head ship gates.

A visually correct screenshot cannot prove hidden state transitions, race safety, authorization, data integrity, or compatibility.

## Provenance

The conditional rendered-evidence idea was informed by `OutThisLife/brooklyn-skills` `visual-verify` (MIT, copyright Brooklyn Nicholson). GitHub Delivery implements it as a head-bound evidence axis inside its existing review architecture rather than as an independent approval system.
