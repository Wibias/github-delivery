# HeadRepo create_pr body transport (GD-AUDIT-068)

## Status

Approved 2026-08-21 (Wave 3, GD-AUDIT-068 only). Branch from current `origin/main`. Do not bundle 069.

## Problem

Fork `create_pr` emits several `--raw-field`s including `body=` plus `head_repo`. `apiBodyTransport` throws `github_body_transport_ambiguous_api_fields` when more than one API field is present. Same-repo `gh pr create` still works. The advertised `head_repo` path cannot execute through the broker.

## Approach

Fold sibling API fields into one `--input -` JSON object whenever a `body=` field is present. Keep a single `body=` requirement. Reject `-F` values that start with `@`. Do not switch GraphQL `-F` identifiers in this PR (069).

## Tests

- `lifecycleCommandFor` headRepo command is accepted by `transportGitHubBody`
- Sibling `-f body=` + `-f other=` fold into JSON stdin
- `-F body=@file` still fails closed
