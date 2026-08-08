# Release and Repository Policy

Canonical rules for GitHub repository controls, merge capabilities, and release publication.

### GD-REL-001 — Protect the live release boundary

Repository policy declares a protected default branch plus a `release` environment with required reviewer(s) and release tags matching `v*`. Checked-in policy is desired state; actual protection exists only when GitHub live settings match it.

### GD-REL-002 — Publish releases only from version-tag pushes

The release workflow may validate via manual dispatch, but publication is only from a `refs/tags/v*` push whose tag/package/version contract matches the release artifacts.

### GD-REL-003 — Verify declared policy against live GitHub state

Repository code cannot make an unprotected branch protected by assertion. Use `scripts/verify-live-repository-policy.mjs` after admin changes and fail/report drift such as missing main rules, checks, or release reviewers.

### GD-REL-004 — Keep workflows least-privileged and pinned

GitHub Actions must use commit-pinned third-party actions, least-privilege permissions, checkout without persisted credentials where required, and must not introduce `pull_request_target` into this trust model.

### GD-REL-005 — Use an enabled repository merge method

Detect repository merge capabilities instead of hardcoding a method that GitHub has disabled. Explicit workflow/user method choices remain bounded by enabled repository capabilities and policy.

### GD-REL-006 — Release verified artifacts with provenance

Rebuild release artifacts from the tagged commit, verify checksums/manifest/version, produce the SBOM, and attach supported attestations before publishing. Refuse to overwrite an existing release silently.

### GD-REL-007 — Server-side controls remain independently necessary

Agent-side expected-head checks, mutation policy, and workflow CI complement but do not replace server-side branch/ruleset/environment controls. Treat missing live controls as security drift even when repository tests are green.
