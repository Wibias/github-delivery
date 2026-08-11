# Runtime capabilities

The natural-language request remains the public interface. Before a workflow relies on a local binary, connected GitHub tool, Bugbot, subagents, or another optional facility, the agent builds one runtime capability snapshot and follows its selected fallbacks.

## Discovery

Run internally at workflow start:

```bash
node scripts/runtime-capabilities.mjs --repo OWNER/REPO
```

`--repo` is optional when the probe runs inside the target checkout: it detects the repository from `gh repo view` or falls back to `git config --get remote.origin.url`. Pass `--repo` explicitly when the checkout is missing or the target differs from the local remote.

The script probes facts available to the local process:

- operating system
- Node.js
- Git
- GitHub CLI
- GitHub CLI authentication
- repository readability through `gh`
- repository write permission through `gh`
- persisted GitHub Delivery watchdog installation/activation state under the active Codex home

Capabilities that exist only in the host may also be declared by the agent environment:

```text
SHIPPING_GITHUB_HOST=codex|cursor|claude|unknown
SHIPPING_GITHUB_CONNECTOR_READ=true|false
SHIPPING_GITHUB_CONNECTOR_WRITE=true|false
SHIPPING_GITHUB_BROKERED_CONNECTOR_WRITE=true|false
SHIPPING_GITHUB_CONNECTOR_RULESETS=true|false
SHIPPING_GITHUB_CONNECTOR_REVIEW_THREADS=true|false
SHIPPING_GITHUB_COMPOSIO=true|false
SHIPPING_GITHUB_BUGBOT=true|false
SHIPPING_GITHUB_SUBAGENTS=true|false
SHIPPING_GITHUB_REVIEW_TOOL=true|false
SHIPPING_GITHUB_PROGRESS_WATCHDOG=none|hooks|stream
```

`CONNECTOR_WRITE` means the host connector has write permission. `BROKERED_CONNECTOR_WRITE` means the github-delivery mutation broker has an adapter that enforces the same request, expected-head, idempotency, exact-text, audit, and verification contract through that connector. Permission without an adapter is not a usable mutation path.

For the progress watchdog, an explicit environment declaration is authoritative for the current controlled runtime. The protected Codex launcher sets `SHIPPING_GITHUB_PROGRESS_WATCHDOG=stream` inside the App Server/client process tree so current-session capability discovery does not depend on a machine-wide guess.

When no explicit runtime declaration exists, discovery reads `~/.codex/github-delivery/watchdog-activation.json` (or the equivalent under `CODEX_HOME`). Invalid or missing activation state never upgrades capability. A fresh Codex hook configuration is persisted as `none` with `hook_trust_required` until the expected unchanged non-managed hook definition has been explicitly confirmed trusted; file presence alone is not interpreted as active hooks.

`hooks` means lifecycle-hook enforcement was explicitly verified for the expected definition. `stream` means the current process or host has a verified launch boundary capable of interrupting an in-flight no-progress turn. `none` means policy-only protection for that capability snapshot. See `references/agent-progress-watchdog.md` for their different guarantees.

## Output contract

```json
{
  "schemaVersion": 1,
  "kind": "github-delivery/runtime-capabilities",
  "host": "codex",
  "os": "win32",
  "repo": "OWNER/REPO",
  "tools": {
    "node": true,
    "git": true,
    "gh": true,
    "ghAuthenticated": true
  },
  "github": {
    "repoReadable": true,
    "headWritable": true,
    "brokerWriteAvailable": true,
    "rulesetsReadable": true,
    "reviewThreadsReadable": true
  },
  "runtime": {
    "progressWatchdog": "stream",
    "progressWatchdogAvailable": true,
    "progressWatchdogDegradationReason": null,
    "progressWatchdogLauncherPath": "/path/to/github-delivery/scripts/codex-with-watchdog.mjs"
  },
  "fallbacks": {
    "githubReads": "connector",
    "githubWrites": "connector-broker",
    "rateLimits": "composio",
    "bugReview": "complementary-lenses",
    "standardsReview": "review-tool",
    "parallelism": "subagents",
    "contextEconomy": "streaming-watchdog"
  },
  "degraded": []
}
```

## Workflow rules

- A read-only workflow requires `readyForReadOnly: true`.
- A mutation workflow requires `readyForMutation: true` before the first broker execution.
- Connected GitHub reads are preferred when declared; authenticated `gh` is the fallback.
- A connected write path is usable only when a broker adapter is declared. Otherwise authenticated writable `gh` is used through `github-mutate.mjs`.
- The write fallback is reported as `connector-broker`, `gh-broker`, or `unavailable`.
- When `gh` is authenticated but no repository could be detected, read/write fallbacks are `unprobed` with `github_repo_not_detected` in `degraded`. Re-run with `--repo OWNER/REPO` or use direct evidence before claiming the write path is blocked.
- Raw connector write permission without a broker adapter produces `github_write_not_brokered` and cannot make the workflow mutation-ready.
- Composio rate-limit checks are preferred when declared; authenticated `gh` is the fallback.
- Bugbot is used only on Cursor when both host and capability declarations permit it. Every other host uses complementary lenses.
- Subagents are used only when declared. Otherwise run the work in-session without claiming fan-out occurred.
- `runtime.progressWatchdog` is `stream`, `hooks`, or `none`; the corresponding `contextEconomy` fallback is `streaming-watchdog`, `lifecycle-hooks`, or `policy-only`.
- `progressWatchdogDegradationReason` can expose `hook_trust_required`, `streaming_interruption_unavailable`, or another concrete activation degradation instead of letting the workflow assume stronger enforcement.
- `progress_watchdog_unavailable` is included in `degraded` when no runtime watchdog is active. A more specific activation reason can still be present in `runtime.progressWatchdogDegradationReason`.
- Missing ruleset or review-thread evidence is degraded capability and must flow into an unknown gate result rather than being guessed.

## Offline fixtures

Tests and incident reproduction can supply probe data without invoking any external command:

```bash
node scripts/runtime-capabilities.mjs --input capability-fixture.json
```

This mode is safe with an empty `PATH` and is used by CI. Explicit fixture declarations can override persisted activation for controlled tests.

## Natural-language example

For `merge PR #32`, the agent:

1. loads `github-delivery` and `references/merge-pr.md`;
2. discovers capabilities;
3. stops if no reliable GitHub read or brokered write path exists;
4. runs the authoritative gate;
5. executes broker mutations through `connector-broker` or `gh-broker`;
6. reports degraded fallbacks, including watchdog degradation, when the ideal runtime surface was unavailable.
