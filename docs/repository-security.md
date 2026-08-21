# Repository security configuration

The files in this repository define the desired security baseline. GitHub settings must still be applied by a repository administrator after the corresponding workflows have run at least once.

## Main branch ruleset

Apply `.github/repository-policy.json` to `main`:

- require pull requests and resolved conversations
- dismiss stale approvals after new commits
- reject force pushes and branch deletion
- allow merge commits only
- enable **Update branch** and auto-merge
- require the Node 22 Ubuntu compatibility lane, the canonical Node 24 Ubuntu lane, the Node 24 Windows authority lane, Dependency Review, and both CodeQL analyses
- keep bypass access limited to emergency administrators

The architecture contracts run inside the canonical required Node 24 Ubuntu check instead of a separate per-PR workflow. Node 26 compatibility also runs inside that required lane, so a supported-runtime regression cannot be green-lit by an unrequired check.

Do not require Scorecard as a pull-request check because it runs on `main`, schedules, and branch-protection changes rather than on every PR.

## Release boundary

Create an environment named `release` with at least one required reviewer. Restrict deployments to protected release tags matching `v*`. The release workflow must remain tag-only for publication; manual dispatch is validation-only.

## Repository features

Enable dependency graph, Dependabot alerts, Dependabot security updates, secret scanning, push protection, code scanning, and private vulnerability reporting when available for the repository.

## Merge settings

Enable merge commits and disable squash and rebase merges so stacked PR ancestry remains explicit. Enable auto-merge and branch updates. These settings are represented in `.github/repository-policy.json` and should be audited against live repository settings after changes.

## Mutation authority boundary

The broker's legacy `mutationMode`, `explicitInstruction`, and `exactTextConfirmed` request fields remain caller-provided policy assertions. They help a compliant agent avoid accidental writes, but they are not independently authenticated user consent.

Legacy Ed25519 `gd1` verification remains available through `GITHUB_DELIVERY_AUTHORITY_PUBLIC_KEY`. New issuers may instead provide a public-only algorithm-agile trust store through `GITHUB_DELIVERY_AUTHORITY_TRUST_STORE`. Invalid supplied grants fail closed instead of falling back to caller assertions.

Trusted grants bind repository, action, mutation mode, concrete resource identifiers, expected PR head where applicable, exact effect parameters such as merge method/reviewer set, and SHA-256 hashes of human-visible text. New grants may additionally require one-time redemption immediately before the exact GitHub write.

Some actions are high-assurance even without global strict mode. In particular:

- human-thread reply execution requires exact outgoing text plus trusted scoped authority;
- full-review verdict publication is a high-assurance `post_comment` special case and requires trusted scoped authority;
- a format-valid same-actor `[GD]` verdict without durable authority provenance is not accepted as merge-review evidence; and
- destructive actions continue to require the trusted-authority boundary defined by the mutation registry/policy.

Set `GITHUB_DELIVERY_REQUIRE_TRUSTED_AUTHORITY=1` only in a deployment where a trusted issuer actually supplies valid grants. Strict mode remains opt-in and extends trusted-authority enforcement to every executed broker mutation; it is not required to make the built-in high-assurance cases high-assurance.

## Durable full-review verdict provenance

`scripts/github-authorize.mjs` stamps an authorized full-review verdict request with a hidden `github-delivery:review-authority` marker carrying the scoped grant while preserving the human-visible verdict hash.

`scripts/verify-verdict-published.mjs` requires both valid verdict format and valid historical trusted-authority provenance. The grant is re-verified at the GitHub comment creation time and must satisfy the protected review-verdict authority contract, including exact scope and one-time redemption semantics. A generic comment that merely copies the `[GD]` verdict format does not satisfy merge-review evidence.

## Local Windows issuer

`authority-host/windows/` provides the first production issuer integration for Windows 11:

- per-user WinForms tray host;
- repository allowlist that starts empty/default-deny;
- Windows Hello approval for protected/high-assurance batches, including maintainer mode, destructive actions, human-thread replies, and format-recognized full-review verdicts;
- one Hello approval may cover one finite precomputed batch, but each mutation receives a separate exact-scope grant;
- non-exportable ECDSA P-256 key persisted by Microsoft Platform Crypto Provider;
- public-key trust store with `kid`-based active/retiring/retired rotation;
- SQLite approval/grant/nonce ledger with one-time consumption;
- current-user Named Pipe with only `status`, `authorizeBatch`, and `redeemGrant` methods.

Allowlist changes and key rotation are local-UI-only and require Windows Hello. The pipe exposes no arbitrary signing, key export, allowlist mutation, policy mutation, or nonce reset operation. The repository and agent receive public keys and signed grants only, never the private signing key.

The Windows issuer's 60-second grants are redeemed after broker fresh-head/target/idempotency preflight and immediately before the exact mutation process is spawned. If execution fails after redemption, the nonce remains spent; a new human authorization is required.

### Threat-model limit

The v1 Windows host is a per-user desktop process. Its design prevents private-key export, removes generic signing/admin methods from the agent protocol, and requires Windows Hello before protected batch issuance. It does **not** claim to sandbox arbitrary malicious native code already executing as the same Windows user from manipulating that user's desktop/processes. A future hardened deployment may move the signer/ledger into a more isolated service/AppContainer or use a stronger Windows-Hello-bound application-key primitive.

This limitation is explicit so the repository does not overstate the trust boundary.

## Verification

Run:

```text
npm run security:repo
```

The command validates workflow action pins, permission boundaries, checkout credentials, forbidden `pull_request_target` use, and the machine-readable repository policy. It does not claim that GitHub settings have been applied; live settings require a separate authenticated audit.

The required Windows authority lane builds the authority host and runs its unattended self-test, XAML smoke test, self-contained publish validation, and install smoke. Those tests validate the Node/C# canonical-scope fixture, ephemeral ES256 verification, SQLite one-time redemption, mutation classification, compiled WinUI resources, bundled runtime identity, and installed-host startup without duplicating the full JavaScript repository suite on Windows.

For live declared-vs-GitHub drift, run:

```text
node scripts/verify-live-repository-policy.mjs OWNER/REPO
```

That command must use a token with repository admin. Default Actions `GITHUB_TOKEN` cannot see Admin ruleset bypass actors, so empty bypass lists from that identity are incomplete, not a pass. Scheduled Repository Policy CI and pushes to main stay fail-closed. Pull-request CI does not fail when that incomplete-attestation error is the only live gap, so a policy PR can land before `REPOSITORY_POLICY_TOKEN` is configured.
