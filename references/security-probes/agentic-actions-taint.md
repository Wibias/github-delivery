# Agentic GitHub Actions taint probe

<!-- probe: agentic-actions-taint -->

Use this probe when a GitHub Actions change places AI/agent execution near attacker-controlled GitHub event data or a privileged workflow context.

The ordinary `ci_actions` surface still checks workflow permissions, pinning, fork behavior, and `pull_request_target`. This probe adds a **source → propagation → AI/tool sink → capability** trace so an agent workflow is not judged safe merely because its YAML is syntactically valid or its token permissions look reasonable in isolation.

## 1. Enumerate untrusted sources

Treat these as attacker-controlled unless the workflow proves otherwise:

- pull request title/body/head branch metadata;
- issue title/body;
- issue/PR/review comments;
- commit messages from untrusted contributors;
- filenames and repository file contents from a fork/PR checkout;
- `gh pr`, `gh issue`, GraphQL, REST, or action outputs that fetch the same data;
- logs, test output, annotations, artifacts, generated reports, or tool output derived from untrusted code.

<!-- assertion: agentic-actions-untrusted-metadata -->

Do not downgrade a source because it first passed through an env var, action output, JSON field, shell variable, temp file, or helper script. Follow the value.

## 2. Trace source to agent/tool sink

For every untrusted source, trace whether it can influence:

- model/system/developer/user prompt text;
- tool descriptions or MCP/tool configuration;
- shell commands or code passed to `eval`/`exec`;
- file paths or repository instructions the agent is told to follow;
- reviewer/verifier prompts or scoring inputs;
- follow-up commands constructed from model output.

Record the complete path, including workflow expressions, env variables, action outputs, helper scripts, files, and API fetches.

<!-- assertion: agentic-actions-source-sink-trace -->

A scanner hit without a source-to-sink path is a lead, not a confirmed finding. A source reaching the model is not automatically exploitable either; continue into capabilities and controls.

## 3. Prove the capability boundary

If untrusted content can influence an agent/model, enumerate what that execution can actually do:

- read repository or workspace files;
- read secrets/tokens/credentials;
- use network access;
- execute shell/processes;
- modify the checkout;
- push branches/tags;
- comment/review/label/close/merge through GitHub APIs;
- mint OIDC credentials;
- upload artifacts or exfiltrate data through allowed destinations.

Check both workflow `permissions` and capabilities delegated by actions, MCP servers, CLIs, credentials, sandbox settings, or external services.

<!-- assertion: agentic-actions-capability-boundary -->

Severity comes from the proven action/data boundary, not from the words "prompt injection" alone.

## 4. `pull_request_target` and checkout composition

For `pull_request_target` or another privileged event context, prove which repository/ref is checked out and which code/config the agent executes or reads.

High-risk compositions include privileged base-repo tokens/secrets combined with:

- checkout of the contributor-controlled PR head;
- execution of contributor-controlled scripts or GitHub Actions code from that head;
- loading agent instructions/config/tool definitions from that head;
- feeding PR-controlled files/logs into an agent that has write/network/secret capabilities.

<!-- assertion: agentic-actions-pr-target-checkout -->

Do not accept "the workflow runs on the base repository" as evidence if a later checkout, API fetch, artifact download, or helper step reintroduces attacker-controlled content.

## Required evidence record

The `agentic-actions-taint` probe application should record:

- workflow/action files inspected;
- untrusted sources found;
- propagation path(s);
- model/tool sink(s);
- effective capabilities/permissions at each sink;
- sanitization/quoting/isolation/approval boundaries checked;
- whether privileged `pull_request_target`/fork composition exists;
- final status: `clean`, `findings`, or justified `n-a`.

A clean result requires the relevant source-to-sink-capability paths to be closed or safely constrained. Missing evidence is not clean.
