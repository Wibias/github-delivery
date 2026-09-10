# Agent debug trace

Agent debug tracing is optional local diagnostics for GitHub Delivery's supported agent runtimes. It is disabled by default.

## Enable tracing

Set one of these values in the agent process environment:

```text
GITHUB_DELIVERY_DEBUG_TRACE=1
GITHUB_DELIVERY_DEBUG_TRACE=true
```

Any other value leaves tracing disabled. The first-class `grok-trace`, `cursor-trace`, and `codex-trace` commands are also explicit opt-ins: each enables tracing only for that invocation without changing the parent shell environment.

Traces are written under `debug-traces/` inside `GITHUB_DELIVERY_STATE_DIR` when that variable is set, otherwise under the normal `~/.github-delivery` state root. On Unix-like systems GitHub Delivery constrains trace directories to mode `0700` and trace files to `0600`. Existing symlinked or foreign-owned trace paths are rejected. Each trace is bounded to 2 MiB by default. Trace-enabled CLI launchers print the exact JSONL path when tracing starts.

The trace format is JSON Lines. Every normalized event includes an ISO 8601 timestamp. Events may also contain provider, lifecycle identifiers, tool type/name, nested parent-tool identity, and provider-specific safe diagnostics. Raw tool inputs and outputs are not persisted by the provider adapters. Cursor hook normalization also excludes user email, workspace roots, transcript paths, model metadata, and tool payloads.

Provider-internal chain-of-thought is not a supported trace payload. Adapters that receive a distinct internal-thinking surface must discard it before recording. Some other provider surfaces expose user-enabled reasoning summaries rather than raw chain-of-thought; those remain private diagnostic material and can still mention sensitive data. Treat debug traces as private and delete them when they are no longer needed.

## Codex

After installing the `github-delivery` npm package, start protected Codex with tracing through the first-class launcher:

```bash
codex-trace
```

Codex arguments pass through to the existing protected launcher. The launcher keeps the app-server watchdog and records normalized reasoning and lifecycle events. Invoking `codex-trace` is itself the trace opt-in for that process.

The low-level checkout-local form remains available for development and diagnostics:

```bash
GITHUB_DELIVERY_DEBUG_TRACE=1 node scripts/codex-with-watchdog.mjs <codex-args>
```

Tracing is diagnostic only. Failure to create or append a trace does not change protected Codex launcher behavior.

## Grok CLI

After installing the `github-delivery` npm package, use the first-class launcher for the normal traced prompt path:

```bash
grok-trace "inspect this repository"
```

Invoking `grok-trace` is itself the trace opt-in for that process. One quoted positional prompt is converted to Grok's headless `-p` form. Existing explicit headless forms also pass through:

```bash
grok-trace -p "inspect this repository"
grok-trace --prompt "inspect this repository"
grok-trace --prompt-file task.txt
```

When additional Grok options are needed, use an explicit `-p`, `--prompt`, or `--prompt-file` form so the launcher does not guess which option value is the prompt.

The launcher delegates to the Grok debug wrapper, which owns `--output-format streaming-messages-json`. That transport exposes `session_id` and `parent_tool_use_id` on assistant/user messages so nested tool activity can be attributed to the spawning tool. Grok `thinking` blocks are discarded before normalization. Sanitized `tool_use` / `tool_result` lifecycle events retain identifiers and outcomes but never tool input/result payloads.

The low-level checkout-local form remains available for development and diagnostics:

```bash
GITHUB_DELIVERY_DEBUG_TRACE=1 node scripts/grok-with-debug-trace.mjs -p "inspect this repository"
```

A plain interactive `grok` session is intentionally not intercepted. `grok-trace` uses the headless message stream because the older `streaming-json` form exposes internal `thought` text while omitting the parent-tool identity needed to distinguish nested/subagent work.

## Cursor CLI

After installing the `github-delivery` npm package, use the first-class launcher for traced print-mode execution:

```bash
cursor-trace "inspect this repository"
```

Invoking `cursor-trace` is itself the trace opt-in for that process. The launcher delegates to the existing Cursor debug wrapper, which owns these flags:

```text
--print
--output-format stream-json
--stream-partial-output
```

Thinking deltas and sanitized tool lifecycle events are normalized into the shared trace schema.

The low-level checkout-local form remains available for development and diagnostics:

```bash
GITHUB_DELIVERY_DEBUG_TRACE=1 node scripts/cursor-with-debug-trace.mjs "inspect this repository"
```

## Cursor IDE / Agent hooks

`scripts/cursor-debug-trace-hook.mjs` reads one Cursor hook JSON object from stdin and appends supported events to one conversation-scoped trace file. The filename uses a SHA-256 digest of the conversation identifier instead of the raw identifier.

Supported normalization includes:

- `afterAgentThought` -> reasoning-summary delta
- `preToolUse` -> tool started
- `postToolUse` / `postToolUseFailure` -> tool completed
- `sessionStart` / `sessionEnd` -> turn lifecycle

The hook never persists `tool_input`, tool output/result payloads, workspace roots, transcript paths, or user email. Trace errors are diagnostic and do not intentionally block agent work.

For an observer-only setup, prefer post-action hooks such as `afterAgentThought`, `postToolUse`, and `postToolUseFailure`. Cursor's `preToolUse` hook is permission-sensitive, so do not add it only for tracing unless you have reviewed the permission semantics of your installed Cursor version.

A user-level Cursor hook entry can call the release-installed script with Node. Example shape:

```json
{
  "version": 1,
  "hooks": {
    "afterAgentThought": [
      { "command": "node <github-delivery>/scripts/cursor-debug-trace-hook.mjs" }
    ],
    "postToolUse": [
      { "command": "node <github-delivery>/scripts/cursor-debug-trace-hook.mjs" }
    ],
    "postToolUseFailure": [
      { "command": "node <github-delivery>/scripts/cursor-debug-trace-hook.mjs" }
    ]
  }
}
```

Replace `<github-delivery>` with the installed GitHub Delivery root. Cursor project hooks use project-relative command paths, while user hooks run from the user's Cursor hook directory. Refer to the current Cursor Hooks documentation for the configuration source and path rules of your installed Cursor version.