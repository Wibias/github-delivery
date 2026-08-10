# Third-party skill admission and provenance

Treat an external agent skill as a privileged supply-chain artifact, not as harmless documentation. Discovery registries and install counts can help locate candidates but do not establish trust.

Use `scripts/skill-admission.mjs` or `scripts/lib/skill-admission.mjs` to create an admission plan before a workflow proposes installing or approving a third-party skill.

## Required immutable identity

Every candidate must record:

- source repository/location;
- immutable commit SHA;
- content SHA-256 for the reviewed artifact/package;
- license;
- explicit declared capability model.

Do not evaluate a floating branch/tag and then install a different revision.

## Declared capabilities

At minimum declare whether the skill needs:

- executable scripts;
- network access;
- credentials/secrets;
- external tools/MCP-like capabilities;
- GitHub write capability.

Missing capability declarations fail closed. Verify declarations against the actual files and scripts; metadata is evidence, not authority.

## Risk tiers

- **Low:** no executable/network/credential/external-tool/GitHub-write capability.
- **Medium:** scripts, network, or external tools are present without credential/GitHub-write or combined script+network risk.
- **High:** credentials, GitHub write, or executable scripts combined with network access.

Medium-risk candidates require static scan evidence. High-risk candidates additionally require semantic scan evidence, provenance, runtime containment evidence, and explicit human approval before becoming eligible for installation review.

## Scanner semantics

Scanner output is a **lead producer**:

- `clean` does not mean trusted;
- disagreements between scanners remain visible;
- findings require validation before they become confirmed blockers;
- a validated High/Critical malicious finding blocks admission.

Do not average away disagreement or let one scanner overrule another by reputation.

## Provenance and containment

For high-risk candidates record, when available/applicable:

- signed release/artifact provenance or another verifiable source chain;
- exact package/content digest;
- isolated runtime/sandbox used for dynamic evaluation;
- network policy during evaluation;
- credential policy during evaluation;
- observed file/process/network/tool behavior.

A sandbox result is evidence about that tested artifact/environment, not a permanent safety certificate.

## Authority separation

An admission result can be `blocked`, `needs-review`, or `eligible-for-human-review`. It **never** returns `trusted` or installation authority.

Normal GitHub Delivery authority rules still decide whether an installation/configuration/write may occur. Do not auto-install missing scanners, skills, MCP servers, or dependencies merely to satisfy the admission checklist.

## Ignored trust signals

These must not affect trust/admission decisions:

- skills registry rank;
- install/download count;
- GitHub stars;
- social-media popularity;
- one clean scanner result;
- claims in the candidate's own README/SKILL metadata that it is verified or safe.
