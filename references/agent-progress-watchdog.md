# Agent Progress Watchdog

GitHub Delivery uses a layered progress watchdog to reduce token waste without weakening evidence, freshness, review, mutation-authority, or Codex hook-trust gates.

## What it protects against

- repeated in-turn intentions such as `Let me read ...` or `Let me check ...` with no tool boundary;
- exact reads repeated on unchanged state;
- ad-hoc high-frequency CI/status polling;
- oversized model-facing tool output when only a focused diagnostic excerpt is required;
- oversized subagent briefs that duplicate large parent-context blocks.

The watchdog never grants GitHub mutation authority, executes a write on the agent's behalf, or treats omitted/unknown evidence as success.

## Activation truth

A normal Codex install/upgrade through `scripts/install-skill.mjs --apply` configures lifecycle hooks when Codex is detected and records watchdog installation state in:

```text
~/.codex/github-delivery/watchdog-activation.json
```

The receipt is non-sensitive activation metadata only. It distinguishes hook configuration from verified active enforcement.

Mode selection is strongest verified mode only:

1. `stream` when the current protected launcher declares the streaming boundary or a host explicitly controls future launches through it;
2. `hooks` only when the expected lifecycle hooks are configured and the exact unchanged definition has been explicitly confirmed trusted;
3. `none` when no runtime surface is verified. `hook_trust_required` distinguishes configured-but-untrusted hooks from an unavailable watchdog.

Codex requires non-managed command hooks to be reviewed and trusted before they run. Trust is tied to the current hook definition, so adding or changing the hook makes it review-pending again. GitHub Delivery therefore never treats `hooks.json` presence as proof that lifecycle enforcement is active and never enables `--dangerously-bypass-hook-trust` by default.

## Enforcement levels

### Policy only

`GD-CORE-008` through `GD-CORE-010` remain the universal fallback when the host exposes no verified runtime lifecycle or streaming interception.

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

The normal Codex installer path configures GitHub Delivery's hook entries automatically on `--apply`. Hook configuration is backup-first, preserves unrelated entries, rejects malformed or symlinked configuration, and is idempotent. `scripts/install-codex-watchdog-hooks.mjs` remains available for repair and non-standard installs.

After a fresh or changed hook definition, use Codex `/hooks` to review and trust it. A host/operator can then refresh the same installer with `--hook-trust-verified --apply`; same-version activation refreshes do not reinstall the skill. The installer accepts that trust assertion only when its expected hook definition is unchanged.

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
6. consumes the private interrupt response rather than leaking it to the client;
7. declares `SHIPPING_GITHUB_PROGRESS_WATCHDOG=stream` inside the launched process tree so runtime inspection sees the current protected session directly.

The bearer token is generated in memory for the launched client and is not persisted. The bridge binds only to loopback. The protected launcher owns the remote endpoint flags and rejects caller-supplied replacements.

This is the only GitHub Delivery layer that can stop the targeted failure while an assistant message is still streaming. The incident regression includes the observed phrase family `Let me check the type`, `Let me check the NOUS_DEF type`, and `Let me check the OAuthProviderDef type`, and requires the interrupt before 500 emitted characters.

Installing the launcher does not silently reroute an already-running or ordinarily-launched Codex CLI/IDE process. A one-off protected session gets its `stream` declaration from the launcher itself. A persisted `stream` activation receipt is reserved for a host integration that explicitly asserts it controls future launches through this entry point.

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
