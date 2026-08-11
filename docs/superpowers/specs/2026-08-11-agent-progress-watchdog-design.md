# Agent Progress Watchdog Design

## Goal

Stop token-hungry no-progress behaviour at runtime, not only through prompt policy, while also reducing repeated reads, manual polling, oversized tool results, and wasteful delegation.

The watchdog is defence in depth. It never grants mutation authority, executes a GitHub write, weakens a gate, or treats missing evidence as success.

## Problem classes

The incident traces expose three distinct classes:

1. **In-turn narration stall** — one assistant turn emits many repeated intentions such as `Let me read ...` without crossing a tool boundary. Policy prose cannot interrupt tokens that are already being generated.
2. **Tool churn** — the agent repeatedly reads the same unchanged state, manually polls CI, or climbs through overlapping checks while still technically making progress.
3. **Context flooding** — raw logs, large JSON payloads, and oversized subagent briefs enter model context even when only a compact decision or failing excerpt is needed.

## Architecture

### 1. Host-agnostic progress watchdog

Add `scripts/lib/agent-progress-watchdog.mjs`.

It maintains only compact state:

- current state generation;
- current assistant-message text window;
- observed intent clauses and novelty;
- read-tool fingerprints with timestamps;
- last external-progress event.

It exposes pure operations for:

- observing streamed assistant text;
- recording external/tool progress;
- deciding whether a read tool call is redundant;
- marking relevant state changes;
- compacting oversized tool output.

A stall is detected conservatively when repeated intent-prefixed clauses become low-novelty without intervening external progress. Exact repeated intentions trip quickly; varied substantive prose does not.

The result is a structured decision such as:

```json
{"action":"interrupt","reason":"no_progress_stall","details":{"repeatedIntent":"read the reference"}}
```

The core never auto-executes a mutation. Interrupting and forcing execution are separate responsibilities so authority remains with `github-mutate.mjs`.

### 2. Codex App Server streaming adapter

Add `scripts/lib/codex-progress-watchdog.mjs` plus a small proxy CLI.

Codex App Server streams `item/agentMessage/delta` notifications and supports `turn/interrupt`. The adapter observes deltas and, on a watchdog interrupt decision, creates exactly one `turn/interrupt` request for that active thread/turn. Internal proxy request ids are consumed by the proxy rather than leaked to its client.

This is the hard boundary that can stop a pathological message while it is still generating.

The adapter also treats tool/item starts and completions as external progress so legitimate action resets the narration-stall window.

### 3. Codex lifecycle-hook adapter

Add a hook entrypoint usable from `PreToolUse`, `PostToolUse`, `Stop`, and `SessionEnd`.

Hooks provide useful enforcement for normal Codex installations but are not described as a streaming replacement:

- `PreToolUse`: block an exact stable read repeated on the same state generation; rate-limit identical volatile polls.
- `PostToolUse`: record progress/state changes and replace only oversized model-facing output with a compact failure-aware excerpt.
- `Stop`: detect a completed stalled assistant message and request one corrective continuation. If the corrective turn stalls again, fail closed instead of recursively continuing.
- `SessionEnd`: remove per-session watchdog state.

Hook state is scoped by Codex session id and kept outside repository content.

### 4. Read and output economy

Read fingerprints use canonical tool name + canonical JSON input + state generation.

Classification is conservative:

- known read-only tools/commands are eligible for deduplication;
- volatile GitHub/CI status reads are allowed again after the configured minimum poll interval;
- known writes/state-changing operations advance the generation;
- unknown tools are treated as progress/state-changing rather than being blocked.

Large tool output is compacted deterministically:

- keep a bounded head and tail;
- preferentially retain lines containing failure/error/blocker/status/exit signals;
- report original and omitted character counts;
- never turn truncation into success evidence.

### 5. Policy and workflow integration

Add a universal context-economy invariant after `GD-CORE-009`:

- prefer one authoritative aggregate read over lower-level probing;
- reuse one state snapshot until relevant state changes;
- do not delegate deterministic script/gate interpretation to a subagent;
- escalate logs progressively from status -> failed job/step -> focused excerpt -> full raw output only when required;
- use the runtime watchdog when the host exposes streaming/tool lifecycle events.

Strengthen CI policy so pending-only CI uses `ci-wait.mjs`; ad-hoc `Start-Sleep`, repeated `gh pr checks`, or equivalent manual polling is not a parallel waiting strategy.

## Safety properties

- No mutation is executed by the watchdog.
- A blocked duplicate read is never converted into positive evidence; the prior evidence must still be valid for the unchanged state generation.
- Volatile reads expire and can be refreshed.
- Any relevant write/state change invalidates stable read deduplication.
- Failed or ambiguous results may be re-read/re-run as required by existing policy.
- Output compaction marks omitted content explicitly.
- Unknown tool classification fails toward allowing evidence acquisition, not toward hiding it.

## Testing

Regression coverage must prove:

1. the uploaded `Let me read ...` pattern interrupts after a bounded number of repeated clauses;
2. normal short planning prose does not trip the watchdog;
3. external tool progress resets the narration window;
4. exact stable reads are blocked on unchanged state and allowed after a state change;
5. volatile polling is rate-limited but becomes readable again after the interval;
6. oversized output is compacted while preserving failure-signalling lines and omission metadata;
7. Codex App Server deltas produce exactly one `turn/interrupt` request for a stalled turn;
8. ordinary App Server messages pass through untouched;
9. hook `Stop` continuation is bounded to one corrective attempt;
10. no watchdog path can create, authorize, or execute a GitHub mutation.

## Compatibility

The watchdog core is host-agnostic. Codex App Server provides the strongest current integration because it exposes streamed assistant-message deltas and in-flight turn interruption. Codex lifecycle hooks provide tool-boundary enforcement and post-turn recovery. Hosts that expose neither capability retain the policy-level fallback and deterministic helper economy rules.