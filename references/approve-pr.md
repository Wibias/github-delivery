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
2. Execute the approval through the controlled mutation boundary as `post_review` with `event: "approve"`, `expectedHead` bound to the captured head, and a concise optional review body.
3. GitHub is authoritative about whether the authenticated mutation identity may approve. If GitHub rejects self-approval or another policy constraint, report that exact blocker; do not replace the failed approval with a comment.
4. Re-read reviews on the same head and require a native `APPROVED` review from the mutation identity before claiming approval succeeded.
5. If the same user request also explicitly asked to merge, continue into `merge-pr` only after the approval action has succeeded and live merge readiness is refreshed.

## Done when

- the requested native GitHub approval is verified on the expected head, or
- the exact GitHub/policy blocker is reported without semantic substitution.
