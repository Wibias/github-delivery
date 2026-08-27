<!-- policy-modules:start -->
Policy modules:
- policy-kernel
- mutation
- evidence
- reviews
- publication
<!-- policy-modules:end -->

# Approve PR

**Trigger:** an explicit request to approve a pull request, such as `approve PR #42`.

## Goal

Perform the GitHub-native **Approve** review action the user requested. Approval is not a `[GD]` verdict comment and must never be silently substituted with one.

## Steps

1. Resolve the target PR and capture its current head SHA.
2. Execute the approval through the controlled mutation boundary as first-class action `approve_pr`, with `expectedHead` bound to the captured head and a stable idempotency key. A concise review body is optional.
3. The approval boundary re-checks the authenticated actor against the PR author before the write. Self-approval fails closed without attempting `gh pr review --approve`. Other GitHub policy constraints remain authoritative and are reported as blockers rather than substituted with comments.
4. Re-read reviews on the same head and require the idempotent native `APPROVED` review before claiming approval succeeded.
5. If the same user request also explicitly asked to merge, continue into `merge-pr` only after the approval action has succeeded and live merge readiness is refreshed.

## Done when

- the requested native GitHub approval is verified on the expected head, or
- the exact local/GitHub policy blocker is reported without semantic substitution.
