# Agent Progress Watchdog

GitHub Delivery uses a layered progress watchdog to reduce token waste without weakening evidence, freshness, review, or mutation-authority gates.

## What it protects against

- repeated in-turn intentions such as `Let me read ...` with no tool boundary;
- exact reads repeated on unchanged state;
- ad-hoc high-frequency CI/status polling;
- oversized model-facing tool output when only a focused diagnostic excerpt is required.

The watchdog never grants GitHub mutation authority, executes a write on the agent's behalf, or treats omitted/unknown evidence as success.

## Enforcement levels

### Policy only

`GD-CORE-008` through `GD-CORE-010` remain the universal fallback when the host exposes no runtime lifecycle or streaming interception.

This reduces ordinary waste but cannot forcibly stop a pathological assistant message while that message is already being generated.

### Codex lifecycle hooks

Use `scripts/codex-watchdog-hook.mjs` for `PreToolUse`, `PostToolUse`, `Stop`, and `SessionEnd`.

This layer can:

- block an exact stable duplicate read on unchanged state;
- rate-limit identical volatile polls;
- compact oversized model-facing tool output while retaining failure/error/blocker signals;
- detect a completed no-progress assistant message at `Stop` and request one corrective continuation;
- fail closed if that corrective continuation stalls again;
- delete per-session state at `SessionEnd`.

Hook state is stored outside repository content. Session ids and read inputs are represented only by SHA-256 fingerprints; raw tool arguments are not persisted.

Lifecycle hooks cannot reclaim tokens already emitted inside the assistant message that reaches `Stop`.

Example hook command for a skill installed under the standard agents directory:

```json
{
  "description": "GitHub Delivery progress watchdog",
  "hooks": {
    "PreToolUse": [{"hooks": [{"type": "command", "command": "node ~/.agents/skills/github-delivery/scripts/codex-watchdog-hook.mjs", "commandWindows": "node \"%USERPROFILE%\\.agents\\skills\\github-delivery\\scripts\\codex-watchdog-hook.mjs\""}]}],
    "PostToolUse": [{"hooks": [{"type": "command", "command": "node ~/.agents/skills/github-delivery/scripts/codex-watchdog-hook.mjs", "commandWindows": "node \"%USERPROFILE%\\.agents\\skills\\github-delivery\\scripts\\codex-watchdog-hook.mjs\""}]}],
    "Stop": [{"hooks": [{"type": "command", "command": "node ~/.agents/skills/github-delivery/scripts/codex-watchdog-hook.mjs", "commandWindows": "node \"%USERPROFILE%\\.agents\\skills\\github-delivery\\scripts\\codex-watchdog-hook.mjs\""}]}],
    "SessionEnd": [{"hooks": [{"type": "command", "command": "node ~/.agents/skills/github-delivery/scripts/codex-watchdog-hook.mjs", "commandWindows": "node \"%USERPROFILE%\\.agents\\skills\\github-delivery\\scripts\\codex-watchdog-hook.mjs\""}]}]
  }
}
```

Configure this in the host's trusted hook configuration. GitHub Delivery does not silently modify global host configuration.

Declare this capability to runtime inspection with:

```text
SHIPPING_GITHUB_PROGRESS_WATCHDOG=hooks
```

### Codex App Server streaming proxy

For the strongest boundary, launch Codex App Server through:

```text
node ~/.agents/skills/github-delivery/scripts/codex-app-server-watchdog-proxy.mjs
```

On Windows use the equivalent path under `%USERPROFILE%\.agents\skills\github-delivery`.

The proxy transparently forwards App Server JSONL traffic, observes streamed assistant-message deltas, and issues one private `turn/interrupt` request when repeated low-novelty intent narration crosses the watchdog threshold. Responses to the proxy's private interrupt requests are consumed rather than forwarded to the client.

This is the only GitHub Delivery layer that can stop the targeted failure while the assistant message is still streaming. A client must intentionally launch/use this proxy instead of plain `codex app-server`; the normal CLI or IDE is not automatically rerouted through it.

Declare this mode with:

```text
SHIPPING_GITHUB_PROGRESS_WATCHDOG=stream
```

## Read economy

Stable read fingerprint:

```text
SHA-256(state-generation + tool-name + canonical-tool-input)
```

A repeated stable read on the same generation is blocked. Any relevant write/state change increments the generation and invalidates the read cache.

Volatile reads are rate-limited rather than cached forever. The default interval is 30 seconds. When pending required CI is the only blocker, `scripts/ci-wait.mjs` remains authoritative and manual polling is not a parallel waiting mechanism.

Unknown tools are not denied by economy classification. This avoids suppressing evidence when a future host/tool is not yet classified.

## Output economy

Oversized tool output is reduced deterministically to a bounded head/tail plus unique failure-signalling lines. The result records original and omitted character counts.

Compaction is never positive evidence. If omitted content is required to diagnose ambiguity or failure, retrieve the focused missing evidence or the full raw output as the final escalation step.