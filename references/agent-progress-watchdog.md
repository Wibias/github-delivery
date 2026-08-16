# Agent Progress Watchdog

GitHub Delivery uses layered progress enforcement to bound token waste without weakening evidence, freshness, review, mutation-authority, or Codex hook-trust gates.

The v0.5.0 design deliberately separates three concerns:

1. **runtime stall enforcement** stops a single Codex turn that is generating without real progress;
2. **evidence economy** prevents the same underlying evidence from being reacquired through different command shapes;
3. **workflow convergence** keeps the selected GitHub Delivery workflow on a persistent legal phase graph with explicit budgets and checkpoints.

The watchdog never grants GitHub mutation authority, executes a write on the agent's behalf, or treats omitted/unknown evidence as success.

## What it protects against

- repeated in-turn intentions such as `Let me read ...`, `Run it`, or `I'll execute ...` before a useful tool boundary;
- tool-call emission stalls where the model repeatedly announces `run`, `execute`, `wire`, `add`, `edit`, `fix`, or similar actions but never produces a real tool item;
- malformed tool-protocol scaffolding such as repeated `<atool>...</atool>` or related invocation markup in generated text;
- channel-hopping loops that move between agent-message, reasoning-summary, supported raw-reasoning, and plan text;
- long unique no-progress generation that avoids exact-repeat detection by continuously changing wording;
- read-exploration spirals where different reads/searches are selected without execution, state change, phase progress, or a concrete blocker;
- exact reads repeated on unchanged state;
- semantically equivalent evidence reads that target the same authoritative resource through different filters or shell syntax;
- ad-hoc high-frequency CI/status polling;
- workflow rerouting/replanning loops on unchanged facts;
- oversized subagent briefs that duplicate large parent-context blocks.

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

A verified live `stream` declaration supersedes stale hook-era degradation metadata. A protected session must not report `stream` together with `streaming_interruption_unavailable` merely because an older activation receipt was created before the protected launcher started.

Codex requires non-managed command hooks to be reviewed and trusted before they run. Trust is tied to the current hook definition, so adding or changing the hook makes it review-pending again. GitHub Delivery therefore never treats `hooks.json` presence as proof that lifecycle enforcement is active and never enables `--dangerously-bypass-hook-trust` by default.

## Runtime progress model

The watchdog does not treat every completed tool call as proof of forward progress. Each confidently classified tool/item belongs to one of these categories:

- **evidence**: reads, searches, list/view/status/diff operations, hosted stream-visible WebSearch/image viewing, and read-like MCP/dynamic tools;
- **execution**: focused tests, builds, lint/check/verification commands, and other confidently classified non-read execution;
- **state change**: edits, writes, file changes, and confidently classified write-like tools/commands;
- **delegate**: subagent/collaboration work;
- **neutral**: unknown or non-progress protocol items.

Evidence is useful, but it does not reset repeated-narration history. Successful execution resets the consecutive evidence streak and no-progress generation budget without invalidating stable-read fingerprints. State progress also increments the state generation and invalidates state-bound read/evidence identities. Unknown tools are neutral rather than being allowed to reset the watchdog accidentally.

A tool merely **starting** is not execution/state progress. A real `item/started` clears only the pending "tool never emitted" signal. Repeated-narration/no-progress history is retained until the runtime proves real progress.

In protected stream mode the model also consumes Codex-native progress signals:

- `turn/diff/updated`: a first non-empty or materially changed aggregated diff is state progress; an identical diff is not;
- `turn/plan/updated`: an increased count of completed plan steps is workflow progress;
- `thread/tokenUsage/updated`: cumulative generated **output tokens** are tracked from the last real progress point. Input/context growth does not consume the generation budget when Codex exposes output-token accounting.

A no-op `fileChange` completion is not sufficient to reset the hard generation budget; material diff evidence owns that decision.

## Enforcement levels

### Policy only

`GD-CORE-008` through `GD-CORE-010` remain the universal fallback when the host exposes no verified runtime lifecycle or streaming interception.

Policy reduces ordinary waste but cannot forcibly stop a pathological assistant message while that message is already being generated.

### Codex lifecycle hooks

`scripts/codex-watchdog-hook.mjs` handles `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`, and `SessionEnd`.

This layer can:

- block an exact stable duplicate read on unchanged state;
- rate-limit identical volatile polls;
- warn once at 8 consecutive supported evidence attempts without execution/state progress;
- deny the 12th and later supported evidence attempt until execution/state progress occurs or a new turn begins;
- derive semantic evidence identities for supported shell/GitHub Delivery helper reads and block a later read when authoritative evidence already covers the requested dimensions in the same state generation;
- classify Windows/PowerShell forms such as `git -C`, `Get-ChildItem`, compound/grouped commands, GitHub CLI reads/writes, and owned GitHub Delivery helpers conservatively;
- reject an oversized `Agent`/subagent tool input and require a focused source-referenced brief;
- detect a completed no-progress assistant or subagent message and keep a bounded corrective continuation active until a real `PreToolUse` boundary is reached;
- allow up to three corrective continuations by default while one stall still has not reached a real tool/action boundary, then fail closed;
- retain per-turn recovery probation after a corrective continuation reaches `PreToolUse`, so a second fresh narration stall in that same turn hard-stops instead of receiving a new 1/3 recovery cycle;
- quarantine the same model for the task after that second post-recovery stall, requiring a model change or a new task before resuming;
- hard-stop malformed tool-protocol emission stalls immediately rather than spending the narration-recovery budget on them;
- delete all hashed turn/agent state for a session at `SessionEnd`.

The narration-recovery obligation persists across short follow-up messages that would not independently cross the repeated-intent detector threshold. Reaching `PreToolUse` clears the active recovery obligation and the pending "tool never emitted" signal even when evidence-economy policy then blocks the selected tool as a duplicate or otherwise disallowed read. If that tool boundary was reached only after watchdog recovery, a separate probation marker remains for the rest of the turn. A later fresh no-progress narration stall therefore fails closed rather than starting another recovery sequence. A tool boundary is not itself execution or state progress; the ordinary progress counters still require the corresponding successful execution/state evidence.

The 8/12 evidence limits are defaults and are intentionally turn-scoped. Exact duplicate/poll/semantic-coverage protection is independent and can block earlier. The default subagent-input budget is 6,000 serialised characters. These are context/progress budgets, not authority or correctness gates.

**Successful `PostToolUse` results are never replaced or truncated by the generic watchdog.** Destroying a successful tool result can force the model to reacquire the same evidence through another command. When output must be reduced, the authoritative helper/source should emit a compact result with an explicit contract; the hook retains only compact internal counters/evidence metadata.

Hook state is stored outside repository content under a hashed session directory. Every turn-scoped event includes `session_id + turn_id`; when Codex actually supplies `agent_id`, that value is included in the hashed state scope too. Updates use an exclusive per-scope lock with bounded acquisition, stale-lock recovery, restrictive permissions where supported, and atomic replacement. Malformed state fails explicitly rather than silently resetting protection. Persisted state contains only counters, generations, timestamps, evidence metadata and SHA-256 fingerprints. Raw prompts, assistant text, tool arguments, tool output, bearer tokens and repository secrets are not persisted.

Codex local tool hooks do not cover every host/tool surface. Hosted tools such as WebSearch are not assumed to pass through `PreToolUse`/`PostToolUse`, and lifecycle hooks cannot reclaim tokens already emitted inside the assistant message that reaches `Stop` or `SubagentStop`. Hook mode is therefore a deterministic supported-tool boundary, not a universal hard interrupt. Recovery probation limits repeated incidents after the first completed bad response, but it does not turn `Stop` into a streaming cancellation surface.

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
5. observes generated text from `item/agentMessage/delta`, `item/reasoning/summaryTextDelta`, supported `item/reasoning/textDelta`, and `item/plan/delta` through one shared detector;
6. consumes `turn/diff/updated`, `turn/plan/updated`, and `thread/tokenUsage/updated` as channel-independent progress/budget signals;
7. observes supported App Server item start/completion events, including hosted WebSearch/image visibility;
8. issues one private `turn/interrupt` when a repeated/low-novelty stall, tool-emission stall, malformed protocol stall, hard generation budget, or hard evidence budget is crossed;
9. requires the private interrupt request to be acknowledged within a bounded interval;
10. fails closed if a required watchdog notification is opted out, required generated-text visibility disappears, the router fails, or an interrupt errors/times out;
11. declares `SHIPPING_GITHUB_PROGRESS_WATCHDOG=stream` only inside the launched process tree.

All generated-text channels share one detector. Switching from reasoning to plan to agent-message text therefore cannot buy a fresh loop budget.

### Active-turn hard bounds

Production defaults for active no-progress generation in protected stream mode are:

- generated characters: warning at **4,000**, hard interrupt at **8,000**;
- cumulative generated output tokens since the last real progress: warning at **1,024**, hard interrupt at **2,048**;
- imminent tool-execution clauses without a real tool start: hard interrupt at **6**;
- malformed protocol-emission chunks: hard interrupt at **2**.

These stream-specific defaults deliberately spend far less output on a fast pathological model than the generic watchdog constructor defaults. They are backstops. Exact/low-novelty intent detection or semantic evidence blocking can stop a loop earlier, and callers can still provide explicit watchdog overrides for controlled tests or integrations.

When the plan is fully completed, final answer generation receives a separate allowance so a legitimate long verdict is not mistaken for active-workflow stalling:

- generated characters: warning at **40,000**, hard interrupt at **64,000**;
- cumulative generated output tokens: warning at **12,000**, hard interrupt at **16,000**.

Tool-emission and malformed-protocol detection remain active during finalization. Starting real runtime work exits finalization mode immediately.

The bearer token is generated in memory for the launched client and is not persisted. The bridge binds only to loopback, validates the WebSocket v13 upgrade, requires the bearer token in normal launcher use, permits one client, requires masked client frames, and bounds individual frames. The protected launcher owns the remote endpoint flags and rejects caller-supplied replacements.

A bridge enforcement failure destroys the protected client connection. The launcher races that failure against normal client exit and kills both the client and App Server process before returning an error. It must never leave a process running while continuing to claim `stream` protection after the enforcement contract is lost.

Installing the launcher does not silently reroute an already-running or ordinarily-launched Codex CLI/IDE process. A one-off protected session gets its `stream` declaration from the launcher itself. A persisted `stream` activation receipt is reserved for a host integration that explicitly asserts it controls future launches through this entry point.

**Maturity:** Codex currently documents `app-server` and its WebSocket transport as experimental and unsupported for production workloads. GitHub Delivery therefore treats this launcher as the strongest available Codex enforcement boundary, not as a stable production host API. Lifecycle hooks and policy fallback remain available when that experimental streaming surface is inappropriate.

The older `scripts/codex-app-server-watchdog-proxy.mjs` remains useful to custom stdio App Server clients. It uses the same per-turn progress model; custom clients still own responsibility for the rest of their transport/process lifecycle.

## Evidence economy

Exact stable read fingerprints remain available for generic reads:

```text
SHA-256(state-generation + tool-name + canonical-tool-input)
```

A repeated stable read on the same generation is blocked. State progress increments the generation and invalidates the read cache. Execution progress does not invalidate it, because running a test does not make an unchanged file read novel.

For supported GitHub/owned-helper evidence, v0.5.0 also derives a **semantic evidence key** independent of incidental shell filtering. For example, two `gh run view <id> --log-failed` commands that differ only by `Select-String` filters still target the same Actions-run resource. The evidence registry records which dimensions the authoritative result covers and blocks reacquisition only when those requested dimensions are already covered in the current state generation.

Owned helpers such as `ci-forensics.mjs`, `review-brief.mjs`, `ship-gate.mjs`, and `runtime-capabilities.mjs` expose structured effect/coverage metadata so controller/hook logic does not have to infer their meaning from filenames or prose.

Volatile reads are rate-limited rather than cached forever. The default identical-poll interval is 30 seconds. When pending required CI is the only blocker, `scripts/ci-wait.mjs` remains authoritative and manual polling is not a parallel waiting mechanism.

The consecutive evidence budget is separate from duplicate/coverage detection. Distinct reads still consume the turn budget, closing the failure mode where an agent avoids dedupe simply by moving to a different file/search on every step. A read denied solely by the hard evidence budget is not committed to the read-fingerprint cache because that tool never ran.

Unknown tools are not denied by economy classification and do not reset the watchdog merely by completing. This avoids both unsafe bypass and false blocking when a future host/tool is not yet classified.

## Workflow convergence controller

Runtime interruption is only one layer. Routed GitHub Delivery work also runs under a persistent workflow controller (`scripts/lib/delivery-workflow-controller.mjs`) with an explicit graph and checkpointed state.

Measurable controller progress is limited to:

- legal phase advancement;
- relevant state change;
- blocker removal;
- production of required missing evidence;
- completion of required execution.

Changing narration does not count.

Default controller budgets are:

- no-progress warning after **2** cycles;
- restrict further evidence after **3** no-progress cycles;
- interrupt/escalate after **4** no-progress cycles;
- maximum **3** phase retries;
- maximum **80** workflow steps;
- maximum **30** evidence actions;
- maximum **12,000** tokens per phase;
- maximum **50,000** tokens per workflow;
- maximum **30 minutes** wall time.

The selected route is locked to its declared graph. Workflow profiles and `workflow-brief.mjs` resolve the route/policy packet once; conditional policy is loaded only when its observable condition becomes true. Checkpoints preserve completed phases, refs, blockers, attempts, usage and evidence state so an interrupt/resume does not automatically restart preflight and reread everything.

## Reliability replay gate

`scripts/lib/codex-watchdog-replay.mjs` replays sanitized App Server events deterministically without storing generated text in telemetry output. `npm run reliability:gate` is release-blocking and covers:

- the real Baseline-is-green / tool-emission stall;
- malformed `<atool>` protocol emission;
- cross-channel narration/tool-intent loops;
- repeated filtered reads of one GitHub Actions run;
- long unique no-progress generation;
- cumulative output-token exhaustion;
- legitimate tool-rich investigations with real progress;
- legitimate long completed-plan final verdicts.

A real incident should become a replay fixture instead of remaining an anecdotal transcript.

## Output economy

The generic lifecycle hook does **not** truncate or replace successful `PostToolUse` output. That behavior was removed because a compacted replacement can cause the model to believe the evidence is missing and immediately re-read the same resource through another command.

Output economy is therefore source-owned: prefer authoritative helpers that emit the compact decision/evidence needed for the current phase, progressively escalate from status → failing component → focused excerpt → full raw output only when required, and keep omission explicit. Compaction is never positive evidence and cannot convert omitted or unknown content into success.