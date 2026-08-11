# Agent Progress Watchdog

GitHub Delivery uses a layered progress watchdog to reduce token waste without weakening evidence, freshness, review, mutation-authority, or Codex hook-trust gates.

## What it protects against

- repeated in-turn intentions such as `Let me read ...` or `Let me check ...` before a useful tool boundary;
- read-exploration spirals where the model keeps choosing different reads/searches without reaching execution, a state change, or a concrete blocker;
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

## Progress model

The watchdog does not treat every completed tool call as proof of forward progress. Each confidently classified tool/item belongs to one of these categories:

- **evidence**: reads, searches, list/view/status/diff operations, hosted stream-visible WebSearch/image viewing, and read-like MCP/dynamic tools;
- **execution**: focused tests, builds, lint/check/verification commands, and other confidently classified non-read execution;
- **state change**: edits, writes, file changes, and confidently classified write-like tools/commands;
- **delegate**: subagent/collaboration work;
- **neutral**: unknown or non-progress protocol items.

Evidence is useful, but it does not reset repeated-narration history. Execution resets the consecutive evidence streak and narration window without invalidating stable-read fingerprints. State progress also increments the state generation and invalidates stable-read fingerprints. Unknown tools are neutral rather than being allowed to reset the watchdog accidentally.

A tool merely starting is not execution/state progress. In stream mode an evidence attempt is charged when the item starts so parallel or hanging reads cannot evade the exploration budget.

## Enforcement levels

### Policy only

`GD-CORE-008` through `GD-CORE-010` remain the universal fallback when the host exposes no verified runtime lifecycle or streaming interception.

This reduces ordinary waste but cannot forcibly stop a pathological assistant message while that message is already being generated.

### Codex lifecycle hooks

`scripts/codex-watchdog-hook.mjs` handles `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`, and `SessionEnd`.

This layer can:

- block an exact stable duplicate read on unchanged state;
- rate-limit identical volatile polls;
- warn once at 8 consecutive supported evidence attempts without execution/state progress;
- deny the 12th and later supported evidence attempt until execution/state progress occurs or a new turn begins;
- reject an oversized `Agent`/subagent tool input and require a focused source-referenced brief;
- compact oversized model-facing tool output while retaining failure/error/blocker signals;
- detect a completed no-progress assistant or subagent message and request one corrective continuation;
- fail closed if that corrective continuation stalls again;
- delete all hashed turn/agent state for a session at `SessionEnd`.

The 8/12 evidence limits are defaults and are intentionally turn-scoped. Exact duplicate/poll protection is independent and can block earlier. The default subagent-input budget is 6,000 serialised characters. These are context/progress budgets, not authority or correctness gates.

Hook state is stored outside repository content under a hashed session directory and a hashed `(turn_id, agent_id-or-main)` file. Updates use an exclusive per-turn lock with bounded acquisition, stale-lock recovery, restrictive permissions where supported, and atomic replacement. Malformed state fails explicitly rather than silently resetting protection. Persisted state contains only counters, generation values, timestamps and SHA-256 read fingerprints. Raw prompts, assistant text, tool arguments, tool output, bearer tokens and repository secrets are not persisted.

Codex local tool hooks do not cover every host/tool surface. Hosted tools such as WebSearch are not assumed to pass through `PreToolUse`/`PostToolUse`, and lifecycle hooks cannot reclaim tokens already emitted inside the assistant message that reaches `Stop` or `SubagentStop`. Hook mode is therefore a deterministic supported-tool boundary, not a universal hard interrupt.

The normal Codex installer path configures GitHub Delivery's hook entries automatically on `--apply`. Hook configuration is backup-first, preserves unrelated entries, rejects malformed or symlinked configuration, and is idempotent. `scripts/install-codex-watchdog-hooks.mjs` remains available for repair and non-standard installs.

After a fresh or changed hook definition, use Codex `/hooks` to review and trust it. A host/operator can then refresh the same installer with `--hook-trust-verified --apply`; same-version activation refreshes do not reinstall the skill. The installer accepts that trust assertion only when its expected hook definition is unchanged.

### Protected Codex streaming launcher

For the strongest boundary currently exposed by Codex, launch through the installed entry point:

```text
node ~/.agents/skills/github-delivery/scripts/codex-with-watchdog.mjs
```

On Windows use the equivalent path under `%USERPROFILE%\.agents\skills\github-delivery`.

The launcher:

1. starts the real `codex app-server` on its normal stdio transport;
2. creates a loopback-only authenticated bridge;
3. starts the ordinary Codex client with the documented `--remote` and `--remote-auth-token-env` flags pointed at that bridge;
4. keeps an independent watchdog for every active Codex turn;
5. observes assistant deltas plus supported App Server item start/completion events, including hosted WebSearch visibility;
6. preserves narration-stall history across evidence reads/searches instead of treating them as execution progress;
7. issues one private `turn/interrupt` for repeated low-novelty narration or a hard evidence-budget breach;
8. requires the private interrupt request to be acknowledged within a bounded interval;
9. fails closed if a required watchdog notification is opted out, a non-empty completed agent message appears without its streaming deltas, the router fails, or an interrupt errors/times out;
10. declares `SHIPPING_GITHUB_PROGRESS_WATCHDOG=stream` only inside the launched process tree.

The bearer token is generated in memory for the launched client and is not persisted. The bridge binds only to loopback, validates the WebSocket v13 upgrade, requires the bearer token in normal launcher use, permits one client, requires masked client frames, and bounds individual frames. The protected launcher owns the remote endpoint flags and rejects caller-supplied replacements.

A bridge enforcement failure destroys the protected client connection. The launcher races that failure against normal client exit and kills both the client and App Server process before returning an error. It must never leave a process running while continuing to claim `stream` protection after the enforcement contract is lost.

This is the only GitHub Delivery layer that can stop the targeted failure while an assistant message is still streaming. Regression coverage includes both observed incident classes:

- repeated `Let me check the type` / `Let me check the NOUS_DEF type` / `Let me check the OAuthProviderDef type` narration;
- repeated `Let me read request-log.test.ts.` narration;
- interleaved `narrate -> evidence read/search -> narrate -> different evidence read/search` exploration that previously reset the detector.

The pure narration incident must interrupt before 500 emitted characters. Evidence activity does not grant a fresh narration window, and concurrent turns cannot reset one another.

Installing the launcher does not silently reroute an already-running or ordinarily-launched Codex CLI/IDE process. A one-off protected session gets its `stream` declaration from the launcher itself. A persisted `stream` activation receipt is reserved for a host integration that explicitly asserts it controls future launches through this entry point.

**Maturity:** Codex currently documents `app-server` and its WebSocket transport as experimental and unsupported for production workloads. GitHub Delivery therefore treats this launcher as the strongest available Codex enforcement boundary, not as a stable production host API. Lifecycle hooks and policy fallback remain available when that experimental streaming surface is inappropriate.

The older `scripts/codex-app-server-watchdog-proxy.mjs` remains useful to custom stdio App Server clients. It now uses the same per-turn typed progress model; custom clients still own responsibility for the rest of their transport/process lifecycle.

## Read economy

Stable read fingerprint:

```text
SHA-256(state-generation + tool-name + canonical-tool-input)
```

A repeated stable read on the same generation is blocked. State progress increments the generation and invalidates the read cache. Execution progress does not invalidate it, because running a test does not make an unchanged file read novel.

Volatile reads are rate-limited rather than cached forever. The default interval is 30 seconds. When pending required CI is the only blocker, `scripts/ci-wait.mjs` remains authoritative and manual polling is not a parallel waiting mechanism.

The consecutive evidence budget is separate from duplicate-read detection. Distinct reads still consume the turn budget, which closes the failure mode where an agent avoided dedupe simply by moving to a different file/search on every step.

Unknown tools are not denied by economy classification and do not reset the watchdog merely by completing. This avoids both unsafe bypass and false blocking when a future host/tool is not yet classified.

## Output economy

Oversized tool output is reduced deterministically to a bounded head/tail plus unique failure-signalling lines. The result records original and omitted character counts.

Compaction is never positive evidence. If omitted content is required to diagnose ambiguity or failure, retrieve the focused missing evidence or the full raw output as the final escalation step.
