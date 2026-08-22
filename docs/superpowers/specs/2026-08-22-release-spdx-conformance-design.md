# Release SPDX 2.3 conformance

## Status

Approved 2026-08-22 as leftover GD-AUDIT-040. Branch from current `origin/main`.

## Problem

`createSpdxSbom` emits a hand-rolled object labeled SPDX 2.3 that is not a valid release predicate:

- `documentDescribes` is absent, so the document does not name the package it claims to describe.
- The package checksum is a SHA-256 of concatenated file hashes, not a checksum of a package artifact.
- `creationInfo.created` is frozen at `1980-01-01T00:00:00Z` (zip determinism epoch), not the tagged source commit.
- Nothing fail-closes against the SPDX 2.3 JSON schema before the SBOM is signed/attested.

This does not change 041 (installed manifest mode) or 042 (extraction path identity).

## Approach

1. Require an explicit SPDX `created` timestamp derived from the source committer date. Reject missing values and the synthetic 1980 epoch.
2. Describe the release package from the document: `documentDescribes` plus a `DESCRIBES` relationship.
3. When `filesAnalyzed` is true, emit SPDX 7.9 `packageVerificationCode` from SHA-1 of contained file contents. Do not emit a synthetic package checksum.
4. Validate every produced document against the vendored SPDX 2.3 JSON schema, then against release policy (described package, verification code, real created time). Fail closed before write.

Keep the SBOM deterministic for a given commit: same artifacts and same committer date yield the same document.

## Tests

- Generated SBOMs include `documentDescribes`, a document `DESCRIBES` relationship, and a matching package verification code.
- Generated SBOMs do not use the 1980 created timestamp or a hash-of-hashes package checksum.
- Schema/policy validation rejects missing `documentDescribes`, the 1980 timestamp, and a synthetic package checksum.
- `createSpdxSbom` refuses to return a document that fails validation.
