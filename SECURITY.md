# Security Policy

## Supported versions

Security fixes are applied to the latest `0.1.x` release and to the current `main` branch.

## System and scope

`shipping-github` is an Agent Skill that reads GitHub evidence, evaluates pull-request policy, reviews code, and performs explicitly authorized GitHub mutations. Security-sensitive components include:

- natural-language routing and workflow instructions in `SKILL.md` and `references/`
- evidence capture and the authoritative ship gate
- runtime capability discovery and mutation authorization
- the installer and deterministic distribution builder
- GitHub Actions, release artifacts, checksums, SBOMs, and attestations

## Threat model and trust boundaries

Treat pull-request content, issue text, review comments, repository files, workflow inputs, external instructions, and downloaded artifacts as untrusted. Important threats include prompt injection that attempts to authorize a mutation, stale-head races, command or path injection, excessive GitHub token permissions, compromised Actions or dependencies, installer path traversal, and release-artifact substitution.

## Security invariants

- Natural-language requests never bypass the authoritative ship gate or mutation policy.
- GitHub writes require an allowed mutation profile and any required explicit instruction.
- PR mutations re-check the expected head immediately before execution.
- Incomplete evidence fails closed and cannot produce a ready verdict.
- Workflows use least privilege, full-SHA action pins, and disabled checkout credential persistence.
- Release tags match the package version; artifacts are rebuilt, checksummed, verified, and attested before publication.
- Install and restore operations remain inside the selected target and backup paths.
- Secrets, private vulnerability details, and exact human replies are not published without authorization.

## Reportable findings and severity context

Report realistic paths to unauthorized GitHub mutations, policy or gate bypass, arbitrary command execution, arbitrary file overwrite, credential disclosure, workflow-token escalation, release tampering, cross-repository confusion, or prompt injection that changes security-sensitive behavior. Severity should reflect reachable impact under the documented trust boundary, not merely the presence of a suspicious string.

## Out of scope

The following are not reportable without a concrete security impact in this repository:

- purely theoretical concerns with no reachable path
- social engineering that does not exploit skill or workflow behavior
- denial of service requiring local administrator control of the agent host
- vulnerabilities in unmodified third-party services or Actions
- missing optional tools when the workflow already fails closed

## Reporting a vulnerability

Do not open a public issue for an undisclosed vulnerability.

Submit reports privately through GitHub's vulnerability reporting form:

https://github.com/Wibias/shipping-github/security/advisories/new

Include:

- the affected version or commit
- the impacted workflow or component
- a realistic abuse path and impact assessment
- the expected security property
- minimal reproduction steps or a proof of concept that does not expose third-party systems
- any suggested remediation, if available

Do not include secrets belonging to third parties, test against systems you do not own, or publicly disclose exploit details before coordinated disclosure.

## Response and disclosure timeline

- We aim to acknowledge a vulnerability report within 7 days.
- We aim to provide an initial assessment or request additional information within 14 days.
- We will provide status updates during the investigation when meaningful progress occurs.
- We aim to resolve confirmed vulnerabilities within 90 days, although complex fixes or coordinated dependency disclosures may require more time.
- Public disclosure should be coordinated with the maintainer and should normally occur only after a fix or mitigation is available.

If these timelines cannot be met, the reporter will be informed through the private advisory thread.
