# Turn-Scoped Progress Watchdog Hardening Design

**Date:** 2026-08-11
**Repository:** `Wibias/github-delivery`
**Status:** Direction approved in chat, pending written-spec review
**Target:** Post-0.3.0 watchdog hardening

## Problem

The current watchdog stops one narrow failure well: repeated assistant intent text with no intervening tool activity. It does not safely bound the two real production traces now observed:

1. **Pure pre-tool narration stall**: the model emits the same intent such as `Let me read request-log.test.ts.` hundreds of times before it ever emits a tool call.
2. **Read-exploration spiral**: the model alternates narration with many distinct reads/searches, for example `narrate -> read A -> narrate -> read B -> narrate -> read C`, without reaching implementation, a focused verification step, or a concrete blocker.

The second failure survives because the current watchdog treats any completed non-write tool as external progress and resets narration state. The first failure cannot be interrupted by lifecycle hooks at all because `PreToolUse` and `PostToolUse` do not exist until a tool call is actually emitted.

There are also two state-isolation problems:

- hook state is persisted per `session_id`, even though Codex exposes a `turn_id` on every turn-scoped hook and subagent hooks reuse the parent session id;
- the App Server router currently shares one watchdog instance across all observed turns, so one turn's tool activity can reset another turn's detector.

## Research findings

### Codex lifecycle hooks

Current OpenAI hook documentation says:

- `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `SubagentStop`, and `Stop` are turn-scoped and expose `turn_id`;
- most local function tools use the hook path, including shell, `apply_patch`, MCP, and other local functions;
- hosted tools such as `WebSearch` do **not** use `PreToolUse`/`PostToolUse`;
- specialised tool paths can opt out, so tool hooks are a guardrail rather than a complete enforcement boundary;
- `PreToolUse` can deny a supported tool call but cannot use `continue: false` to terminate the turn;
- `PostToolUse` can replace/stop normal processing of the completed tool result, but the tool has already run and Codex continues from the hook feedback;
- `Stop` sees `last_assistant_message` only after the model has reached a stop boundary. A blocking Stop result asks Codex to continue from a synthetic continuation prompt; it does not reclaim tokens already emitted.

OpenAI's current Codex issue tracker also contains reports of user-level `PostToolUse` not firing on some releases/configurations. This is supporting evidence, not the primary contract, but it reinforces one design rule: **hard exploration enforcement must happen in `PreToolUse`; `PostToolUse` must never be the sole boundary required for safety.**

References:

- https://developers.openai.com/codex/hooks
- https://github.com/openai/codex/tree/main/codex-rs/hooks
- https://github.com/openai/codex/issues

### Codex App Server

Current OpenAI App Server documentation says:

- a turn is one user request plus the agent work that follows;
- App Server streams `item/agentMessage/delta`, `item/started`, `item/completed`, and `turn/completed` notifications;
- `turn/interrupt` cancels an in-flight turn and the turn completes with `status: "interrupted"`;
- App Server exposes item types including `commandExecution`, `fileChange`, `mcpToolCall`, `dynamicToolCall`, `collabToolCall`, `webSearch`, and `imageView`;
- clients may opt out of exact notification methods through `initialize.params.capabilities.optOutNotificationMethods`;
- `turn/started` contains the turn object/turn id but does not itself provide the parent thread id;
- `codex app-server` and WebSocket transport are currently experimental and unsupported for production workloads.

References:

- https://developers.openai.com/codex/app-server
- https://github.com/openai/codex/tree/main/codex-rs/app-server

## Safety definition

"100% safe" cannot truthfully mean "every Codex surface can always be interrupted". OpenAI does not expose a universal hard-interrupt boundary to user-installed hooks, hosted tools bypass local tool hooks, and App Server/WebSocket remains experimental.

For this project, **safe** therefore means:

1. **Controlled stream mode is bounded or fails closed.** If GitHub Delivery claims `stream`, it must observe the notifications needed by the watchdog and must be able to request `turn/interrupt`. If that contract cannot be verified, the protected launcher must not silently continue while claiming stream protection.
2. **Hook mode is deterministic at supported tool boundaries.** It must bound supported read/exploration activity per turn, prevent exact duplicate reads, preserve Codex's hook trust model, and never claim it can stop text already being generated before a tool boundary.
3. **Policy-only mode remains truthful.** Unsupported surfaces are reported as degraded rather than described as protected.
4. **No watchdog decision grants mutation authority or converts missing evidence into success.** Existing GitHub Delivery authority, freshness, review, security, and final-evidence gates remain unchanged.

## Approaches considered

### A. Lower narration thresholds only

Keep the existing reset semantics and interrupt after fewer repeated phrases.

**Rejected.** This catches only the pure pre-tool loop. The real `read A -> read B -> read C` exploration spiral continues resetting the detector forever.

### B. Hook-only hard limits

Add a fixed maximum number of reads and present that as the solution.

**Rejected as the primary design.** Hooks cannot interrupt pure pre-tool text generation, hosted tools such as WebSearch bypass local tool hooks, and `PreToolUse` denial does not terminate the turn. Hook limits are still valuable as a secondary boundary.

### C. Turn-scoped progress epochs with layered enforcement

**Selected.** Separate evidence acquisition from execution progress and state change. Scope every counter to a concrete turn. Use hooks for local tool-boundary budgets and the controlled App Server stream for in-flight narration interruption and hosted-tool visibility.

## Core model

The watchdog will distinguish three kinds of progress.

### Evidence progress

Useful information gathering that does **not** by itself prove the agent is moving toward completion:

- file reads;
- repository searches;
- list/view/status/diff operations;
- WebSearch and page inspection;
- image viewing;
- read-like MCP/dynamic tools.

Evidence activity consumes the turn's exploration budget and **does not reset narration-stall history**.

For hook mode, the budget is charged/reserved at `PreToolUse`, before the read executes. For stream mode, it is charged when the evidence item starts. This prevents parallel, hanging, or repeatedly-started reads from evading the limit. Completion does not double-charge the same item.

### Execution progress

A meaningful action that advances or validates the selected path without necessarily mutating repository state:

- a focused test/build/lint command;
- a non-read command that completes;
- another explicitly classified execution tool.

Execution progress resets the **consecutive evidence streak** and may reset the narration-stall window. It does **not** increment the repository state generation and does not invalidate duplicate-read fingerprints.

### State progress

A completed action that may change the relevant working/repository state:

- `fileChange` completion;
- `apply_patch`/Edit/Write completion;
- a write-like GitHub/MCP/local tool completion;
- a write-like shell command completion.

State progress increments the state generation, clears duplicate-read fingerprints, resets the consecutive evidence streak, and resets narration-stall history.

A tool merely starting is never **progress** even when its start reserves evidence budget. A failed or declined state-changing tool is not assumed successful, although conservative invalidation may be used when side effects could have occurred before failure.

## Turn-scoped state

### Hook mode

Persist watchdog state by:

```text
session_id + turn_id + agent_id-or-main
```

rather than only `session_id`.

Proposed state root:

```text
<tmp>/github-delivery-watchdog/<session-hash>/<turn-scope-hash>.json
```

The persisted record contains only non-sensitive counters and hashes:

- schema version;
- turn id hash / scope identity;
- state generation;
- exact-read fingerprints;
- total evidence attempts;
- consecutive evidence attempts since execution/state progress;
- warning/denial counters;
- execution/state progress counters.

It must never contain prompts, assistant text, raw tool input, tool output, bearer tokens, or repository secrets.

`SessionEnd` removes the whole hashed session directory. New turn ids naturally create clean turn state. Every turn-scoped hook validates its state scope, so correctness does not depend on `UserPromptSubmit` firing first and the installer does not need to add another trusted hook solely for state reset.

### Concurrent hook safety

The current read-modify-write JSON file is vulnerable to lost updates if tool hooks overlap. Add a small state-store component with:

- exclusive per-turn lock creation;
- short bounded lock acquisition;
- stale-lock recovery;
- restrictive file permissions where the platform supports them;
- write-after-lock semantics;
- malformed state treated as an explicit degraded/error condition rather than silently resetting to an unprotected empty state.

The store is isolated from watchdog policy so it can be tested independently.

### Stream mode

The App Server router owns one watchdog state per **turn id**, not one global watchdog per connection.

`turn/started` can initialise a state record from the turn id alone. Once a scoped item/delta provides `threadId`, the state binds that thread id to the turn and rejects inconsistent thread binding. `turn/completed` deletes the turn state. One turn can never reset another turn's narration or evidence budget.

## Narration stall enforcement

Keep the existing deterministic intent normalisation but change its reset rules.

Default stream thresholds remain intentionally aggressive for pathological narration:

- exact normalised intent repeated **3** times -> interrupt;
- at least **6** recent intent clauses with at most **3** unique normalised intents -> interrupt;
- a state/execution progress event may reset the narration window;
- evidence reads/searches do **not** reset it.

The exact production trace `Let me read request-log.test.ts.` repeated hundreds of times must be interrupted well before 500 emitted characters, normally on the third repeated intent.

## Evidence-exploration budget

The budget applies only to tools confidently classified as evidence reads/searches. Unknown tools are not denied merely because GitHub Delivery cannot classify them.

Default per-turn behaviour:

1. Exact stable duplicate read on unchanged state -> **deny immediately**.
2. Identical volatile poll inside the existing refresh interval -> **deny immediately**.
3. Each permitted evidence attempt is reserved before execution (`PreToolUse` in hook mode, `item/started` in stream mode).
4. At **8 consecutive evidence attempts** without execution/state progress -> allow the call but attach a concise model-visible warning: synthesise the evidence already gathered and choose the next execution step; additional reading must be narrowly justified.
5. At **12 consecutive evidence attempts** without execution/state progress -> deny further confidently-classified evidence calls until execution/state progress occurs or a new turn begins.
6. State progress resets the streak and invalidates old stable-read fingerprints.
7. Execution progress resets the streak but does not invalidate stable-read fingerprints.

Why 8/12 instead of a much larger fixed cap: the observed failures become pathological far earlier than 12 reads, while a warning before denial gives legitimate research tasks room to pivot. The limits are configurable for tests/hosts but have safe defaults.

A denial is described truthfully as a **read denial**, not a turn interruption. In hook-only mode the model can still emit text after the denied tool call because Codex does not expose a hard mid-turn interrupt through `PreToolUse`.

## Tool classification

Refactor tool classification into one shared module used by hooks and App Server routing.

Categories:

- `evidence`;
- `execution`;
- `state-change`;
- `delegate`;
- `neutral/unknown`.

### Hook inputs

Classify from canonical `tool_name` plus safe semantic inspection of known command/tool arguments. Extend read-like shell recognition for common read-only commands on Windows and Unix while avoiding ambiguous commands that can mutate state.

### App Server items

Classify using item type plus names/commands where available:

- `webSearch`, `imageView` -> evidence;
- `fileChange` -> state-change on authoritative completion;
- `commandExecution` -> classify command;
- `mcpToolCall` -> classify `appContext.actionName` first, then tool name;
- `dynamicToolCall` -> classify tool name;
- `collabToolCall` -> delegate/neutral, not automatic state progress;
- plan/reasoning/context compaction -> not execution progress.

Unknown item/tool types must not reset the watchdog merely because they completed.

## Controlled stream fail-closed contract

A protected launcher must not silently call itself `stream` if the client disables notifications required by the watchdog.

### Required notifications

The protected bridge relies on at least:

- `item/agentMessage/delta`;
- `item/started`;
- `item/completed`;
- `turn/started`;
- `turn/completed`.

When the client sends `initialize`, the bridge inspects `optOutNotificationMethods`. If any required watchdog notification is disabled, the protected connection is rejected with a clear error instead of continuing unprotected.

### Stream-health verification

Track whether each non-empty `agentMessage` item was observed through deltas. If App Server produces a non-empty completed `agentMessage` without the required delta visibility, mark the protected boundary unhealthy and fail closed rather than continuing to advertise `stream`.

### Interrupt acknowledgement

Internal `turn/interrupt` requests must no longer be blindly swallowed regardless of result.

- successful private responses remain hidden from the client;
- an error response is surfaced to the launcher as a watchdog failure;
- an interrupt acknowledgement timeout is bounded;
- on an unconfirmed/failed interrupt, the protected launcher terminates/degrades the protected session rather than letting the runaway turn continue while claiming stream enforcement.

## Hook fallback behaviour

### PreToolUse

- exact duplicate/poll protection remains;
- evidence attempts are charged before execution;
- evidence budget warning and denial happen here, before the next read executes;
- subagent input budget remains;
- a denied read receives one concise reason that tells the model to synthesise existing evidence and act or report a concrete blocker.

This is the hard local-tool enforcement point. The design does not depend on `PostToolUse` firing for the read budget to work.

### PostToolUse

- classify successful completion as evidence, execution, or state progress;
- do not call a generic `recordExternalProgress()` for every non-write tool;
- evidence completion never double-counts a `PreToolUse` reservation;
- tool-output compaction remains independent of progress classification;
- because PostToolUse cannot undo side effects, is not a universal host boundary, and has had compatibility reports in current Codex releases, correctness must not depend on it as the sole enforcement point.

### Stop / SubagentStop

- retain last-message stall detection as post-turn recovery;
- one corrective continuation is allowed;
- a repeated stall after corrective continuation returns `continue: false`;
- wording must not imply tokens from the completed bad message were recovered.

## Runtime capability truth

Keep the existing `none | hooks | stream` activation model, but strengthen the meaning of `stream`:

- `hooks`: trusted lifecycle definitions are active for supported hook paths, with the documented inability to interrupt pre-tool generation;
- `stream`: the current protected process owns the App Server boundary **and** the required notification/interrupt contract has not been invalidated;
- `none`: no verified enforcement boundary.

If a protected stream session loses its enforcement contract at runtime, it fails closed rather than silently degrading while continuing to report `stream`.

## Regression suite

### Incident A: pure pre-tool narration

Replay the real phrase family:

```text
Let me read request-log.test.ts.
Let me read request-log.test.ts.
Let me read request-log.test.ts.
...
```

through `item/agentMessage/delta` and require one `turn/interrupt` before 500 emitted characters.

### Incident B: interleaved exploration

Replay realistic events:

```text
agentMessage delta: Let me inspect A
item started/completed: read A
agentMessage delta: Let me inspect B
item started/completed: read B
...
```

Requirements:

- evidence start/completion does not reset narration history;
- warning occurs at the configured soft evidence threshold;
- further evidence is denied/stream-interrupted according to the active boundary before the trace can grow remotely close to the observed dozens/hundreds of steps.

### Parallel/hanging evidence

Start multiple read/search items without completing them and prove the exploration budget is still consumed at start/PreToolUse. The hard budget must not be bypassable by concurrency or missing completion events.

### Turn isolation

Run two concurrent turn ids. Bind thread ids from scoped events after `turn/started`. Evidence or execution progress in turn B must not reset turn A. Hook fixtures with the same parent `session_id` but different `turn_id`/`agent_id` must remain isolated.

### State-store concurrency

Run overlapping hook updates against one turn state and prove:

- no lost evidence increments;
- no malformed JSON;
- stale locks recover;
- fresh locks are respected;
- permissions/state path contain no raw tool data.

### Classification contracts

Cover representative:

- stable reads;
- volatile reads;
- Unix/PowerShell read commands;
- focused test/build execution;
- write/apply-patch state changes;
- hosted `webSearch` as stream evidence;
- MCP/dynamic read/write names;
- unknown tools remaining neutral rather than falsely resetting state.

### Protected bridge safety

Require:

- bearer authentication;
- one-client boundary;
- WebSocket upgrade validation;
- frame-size bound;
- rejection when required notifications are opted out;
- private interrupt success is hidden;
- private interrupt error/timeout fails closed;
- completed non-empty agent message without observed deltas fails closed.

### Existing repository gates

Final head must pass:

- targeted watchdog/hook/bridge tests;
- `npm run check`;
- distribution reproducibility/security checks;
- Node 22/24 Ubuntu, Windows, and macOS CI;
- CodeQL;
- Dependency Review;
- Architecture Contracts.

## Acceptance criteria

1. The pure `Let me read request-log.test.ts.` trace is interrupted in controlled stream mode before 500 characters.
2. Interleaving different evidence reads no longer resets narration detection.
3. Hook-only mode denies runaway supported evidence calls per turn instead of rewarding each read as complete progress.
4. Parallel/hanging evidence calls cannot evade the exploration budget.
5. New user turns and subagents do not inherit another turn's exploration budget.
6. Concurrent App Server turns cannot reset each other's watchdog state.
7. Unknown tools cannot bypass the watchdog by being automatically treated as progress.
8. A protected launcher refuses notification opt-outs that would blind the watchdog.
9. Failed/unacknowledged interrupts cannot leave the protected session running while it still claims `stream`.
10. No watchdog state persists raw prompts, assistant text, tool inputs, outputs, tokens, or secrets.
11. Existing GitHub mutation authority and evidence gates remain unchanged.
12. Documentation states the exact guarantee boundary: hard in-flight interruption only on the controlled App Server stream, deterministic local tool-boundary guardrails in trusted hook mode, policy fallback elsewhere.
13. No documentation or runtime output claims universal or production-stable Codex protection while OpenAI documents App Server/WebSocket as experimental.