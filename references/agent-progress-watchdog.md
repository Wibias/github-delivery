# Agent Progress Watchdog

GitHub Delivery uses a layered progress watchdog to reduce token waste without weakening evidence, freshness, review, or mutation-authority gates.

## What it protects against

- repeated in-turn intentions such as `Let me read ...` or `Let me check ...` with no tool boundary;
- exact reads repeated on unchanged state;
- ad-hoc high-frequency CI/status polling;
- oversized model-facing tool output when only a focused diagnostic excerpt is required;
- oversized subagent briefs that duplicate large parent-context blocks.

The watchdog never grants GitHub mutation authority, executes a write on the agent's behalf, or treats omitted/unknown evidence as success.

## Activation truth

A normal Codex install/upgrade through `scripts/install-skill.mjs --apply` activates lifecycle hooks when Codex is detected and records the effective watchdog mode in:

```text
~/.codex/github-delivery/watchdog-activation.json
```

The receipt is non-sensitive activation metadata only. Runtime capability discovery reads it so `none`, `hooks`, and `stream` describe what is actually active instead of merely what code exists in the installed skill.

Mode selection is strongest verified mode only:

1. `stream` when the host has explicitly bound future launches to the protected streaming entry point;
2. `hooks` when lifecycle hooks are active but the launch boundary is not controlled;
3. `none` when neither runtime surface is verified.

## Enforcement levels

### Policy only

`GD-CORE-008` through `GD-CORE-010` remain the universal fallback when the host exposes no runtime lifecycle or streaming interception.

This reduces ordinary waste but cannot forcibly stop a pathological assistant message while that message is already being generated.

### Codex lifecycle hooks

`scripts/codex-watchdog-hook.mjs` handles `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`, and `SessionEnd`.

This layer can:

- block an exact stable duplicate read on unchanged state;
- rate-limit identical volatile polls;
- reject an oversized `Agent`/subagent tool input and require a focused source-referenced brief;
- compact oversized model-facing tool output while retaining failure/error/blocker signals;
- detect a completed no-progress assistant or subagent message and request one corrective continuation;
- fail closed if that corrective continuation stalls again;
- delete per-session state at `SessionEnd`.

The default subagent-input budget is 6,000 serialized characters. It is a context budget, not an authority or correctness gate.

Hook state is stored outside repository content. Session ids and read inputs are represented only by SHA-256 fingerprints; raw tool arguments are not persisted.

Lifecycle hooks cannot reclaim tokens already emitted inside the assistant message that reaches `Stop` or `SubagentStop`.

The normal Codex installer path now reuses the safe hook installer automatically on `--apply`. `scripts/install-codex-watchdog-hooks.mjs` remains available for repair and non-standard installs. Hook configuration is backup-first, preserves unrelated entries, rejects malformed or symlinked configuration, and is idempotent.

### Protected Codex streaming launcher

For the strongest boundary, launch Codex through the installed entry point:

```text
node ~/.agents/skills/github-delivery/scripts/codex-with-watchdog.mjs
```

On Windows use the equivalent path under `%USERPROFILE%\.agents\skills\github-delivery`.

The launcher:

1. starts the real `codex app-server` on its normal stdio transport;
2. creates a loopback-only authenticated bridge;
3. starts the ordinary Codex client with the documented `--remote` and `--remote-auth-token-env` flags pointed at that bridge;
4. forwards JSON-RPC traffic while observing `item/agentMessage/delta` notifications;
5. issues one private `turn/interrupt` when repeated low-novelty intent narration crosses the watchdog threshold;
6. consumes the private interrupt response rather than leaking it to the client.

The bearer token is generated in memory for the launched client and is not persisted. The bridge binds only to loopback. The protected launcher owns the remote endpoint flags and rejects caller-supplied replacements.

This is the only GitHub Delivery layer that can stop the targeted failure while an assistant message is still streaming. The incident regression includes the observed phrase family `Let me check the type`, `Let me check the NOUS_DEF type`, and `Let me check the OAuthProviderDef type`, and requires the interrupt before 500 emitted characters.

Installing the launcher does not silently reroute an already-running or ordinarily-launched Codex CLI/IDE process. `stream` is recorded only when the host actually controls launches through this entry point. Otherwise lifecycle hooks remain active and the receipt reports `hooks` with `streaming_interruption_unavailable`.

The older `scripts/codex-app-server-watchdog-proxy.mjs` remains useful to custom stdio App Server clients. It provides the same delta watchdog for clients that already own the App Server protocol connection.

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
