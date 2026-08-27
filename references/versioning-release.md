<!-- policy-modules:start -->
Policy modules:
- policy-kernel
- evidence
- git
- publication
- releases
<!-- policy-modules:end -->

# Versioning, changelog, and release preparation

**Trigger:** Choose a release version, classify a SemVer bump, prepare version metadata/changelog changes, check tag/version consistency, or prepare a release candidate. Actual tag creation, GitHub Release publication, npm publication, or merge happens only when separately authorized by the governing workflow.

## Goal

Make versioning and release preparation part of github-delivery's own Git/GitHub lifecycle. Produce one evidence-backed consumer-facing release identity without turning preparation into publication authority.

## Precedence

1. Follow the repository's existing version source of truth, release policy, supported compatibility contract, and changelog format first.
2. `references/policy/releases.md`, `references/policy/publication.md`, `references/policy/git.md`, and the policy kernel remain authoritative where release safety or publication is involved.
3. Do not hand-edit additional version files merely because another ecosystem commonly has them. Inventory the repository's real version surfaces and generated derivatives.
4. Preparing a version, changelog, tag message, or release notes is not authorization to create a tag, merge, publish a GitHub Release, upload release assets, or publish to a package registry.

## 1. Establish the release delta

Before choosing a version, establish the current release baseline from repository evidence:

- identify the latest relevant released/tagged version according to project policy;
- identify the exact candidate range from that released generation to the intended release head;
- inspect merged changes, user-visible behavior, compatibility changes, security fixes, migrations, deprecations, and release metadata in that range;
- distinguish already-released changes from unreleased work so the changelog does not duplicate history;
- account for intentionally omitted or deferred changes when they affect consumer expectations.

A commit count or `git log` dump is not a release summary. The release delta is the set of consumer-relevant effects in the selected range.

## 2. Choose the SemVer impact

When the repository uses Semantic Versioning, classify the highest observable consumer impact in the release:

- **MAJOR** — a breaking change that requires supported consumers to change how they use the released contract.
- **MINOR** — backward-compatible new functionality or a newly supported capability.
- **PATCH** — backward-compatible bug fixes, documentation/release corrections, or implementation fixes that add no new supported capability.

Classify observable compatibility rather than commit labels or diff size. A small change can be breaking; a large internal refactor can remain PATCH when the supported public contract is unchanged.

When impact is ambiguous, investigate the actual consumer contract: documented API/CLI behavior, persisted formats, supported configuration, automation contracts, package exports, compatibility guarantees, and release policy. Do not mechanically jump to MAJOR solely because uncertainty exists, and do not hide a proven breaking change under MINOR/PATCH.

If the project follows another versioning policy, use that policy and state it instead of pretending SemVer applies.

## 3. Update version identity consistently

Once the target version is established:

1. identify the canonical version source;
2. update required tracked metadata that is intentionally versioned in the repository;
3. regenerate derived version files through their owner/generator when applicable;
4. verify all required public version surfaces agree;
5. do not rewrite historical changelog/version entries to make the new release look cleaner.

If the project derives package/runtime versions from Git tags, prepare the tag/version relationship rather than introducing a competing hand-edited source of truth.

## 4. Curate a human changelog

A changelog is the consumer-facing answer to "what changed and do I care?", not a raw commit list.

Follow the repository's existing format. When it uses Keep-a-Changelog-style groups, place noteworthy items under applicable headings such as:

- Added
- Changed
- Fixed
- Deprecated
- Removed
- Security

Write from observable effect first. Include implementation detail only when it helps consumers understand compatibility, migration, security, operations, or why the behavior changed. Consolidate multiple commits/PRs that implement one consumer-facing outcome; do not inflate routine test/refactor commits into separate release features.

Breaking changes need a clear migration note or pointer when the repository's release policy supports one. Deprecations should name the replacement/removal condition when known.

## 5. Tag and release identity

Before any tag is created, verify:

- target version matches the candidate metadata and changelog;
- intended tag name follows repository convention (commonly `vX.Y.Z`);
- tag target is the exact authorized release commit;
- release notes/changelog describe that same candidate range;
- no newer commit has silently replaced the reviewed release head.

A tag is a remote/release mutation. **Tag creation or release publication requires explicit user authorization** through the governing release workflow. A request such as "choose the next version" or "update the changelog" does not grant that authority.

For github-delivery itself, use the repository's protected release preparation/publication machinery rather than ad-hoc `git tag`, `gh release`, or `npm publish` commands.

## 6. Release preparation checklist

Before reporting a release candidate prepared:

- version bump matches the highest supported consumer impact;
- current candidate range was measured from the correct previous release;
- required version files agree;
- changelog entry is curated and complete for material consumer effects;
- compatibility/migration notes exist where required;
- repository-required tests/build/lint/security/release checks pass on the candidate head;
- generated release metadata is reproducible where the repository requires it;
- tag/version/changelog identities are consistent;
- no tag, GitHub Release, registry publication, or merge is claimed unless it was explicitly authorized and post-verified.

If publication is authorized, hand off to the repository's canonical release workflow and keep cross-system publication ordering/idempotency rules from `references/policy/releases.md` authoritative.

## Provenance

This reference adapts Semantic Versioning, release-tag, and human-curated changelog practices from Addy Osmani's MIT-licensed `addyosmani/agent-skills` `git-workflow-and-versioning` skill. It is rewritten to use repository-local release conventions, observable consumer impact, github-delivery evidence rules, and explicit publication authority instead of treating generic Git commands as release permission.
