# Repository security baseline implementation plan

**Goal:** Add supply-chain workflows and executable policy checks without granting unnecessary GitHub permissions.

### Task 1: Lock workflow policy with failing tests
- Reject unpinned Actions, `pull_request_target`, implicit checkout credentials, and unapproved write permissions.
- Validate the desired repository-policy schema.

### Task 2: Add security workflows
- Add Dependabot, Dependency Review, CodeQL, and Scorecard.
- Pin all Actions to full commit SHAs and use job-scoped write permissions.

### Task 3: Add repository policy and disclosure guidance
- Add `SECURITY.md`, `.github/repository-policy.json`, and the administrator runbook.

### Task 4: Integrate and verify
- Add the repository-security validator to `npm run check`.
- Run focused tests and the complete hosted matrix.
