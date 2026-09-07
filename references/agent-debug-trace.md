# Agent debug trace

Agent debug tracing is optional local diagnostics for GitHub Delivery's supported agent runtimes. It is disabled by default.

## Enable tracing

Set one of these values in the agent process environment:

```text
GITHUB_DELIVERY_DEBUG_TRACE=1
GITHUB_DELIVERY_DEBUG_TRACE=true
```

Any other value leaves tracing disabled.

Traces are written under `debug-traces/` inside `GITHUB_DELIVERY_STATE_DIR` when that variable is set, otherwise under the normal `~/.github-delivery` state root. On Unix-like systems GitHub Delivery constrains trace directories to mode `0700` and trace files to `0600`. Existing symlinked or foreign-owned trace paths are rejected. Each trace is bounded to 2 MiB by default.

The trace format is JSON Lines. Normalized events may contain provider, lifecycle identifiers, tool type/name, and reasoning-summary text. Raw tool inputs and outputs are not persisted by the provider adapters. Cursor hook normalization also excludes user email, workspace roots, transcript paths, model metadata, and tool payloads.

Reasoning-summary text is intentionally persisted when tracing is enabled. It can itself mention sensitive data. Treat debug traces as private diagnostic material and delete them when they are no longer needed.

## Codex

The existing protected Codex launcher records normalized app-server reasoning and lifecycle events when tracing is enabled:

```bash
GITHUB_DELIVERY_DEBUG_TRACE=1 node scripts/codex-with-watchdog.mjs <codex-args>
```

Tracing is diagnostic only. Failure to create or append a trace does not change protected Codex launcher behavior.

## Grok CLI

Use the Grok debug wrapper for headless prompt execution:

```bash
GITHUB_DELIVERY_DEBUG_TRACE=1 node scripts/grok-with-debug-trace.mjs -p "inspect this repository"
```

The wrapper owns `--output-format streaming-json`. It records Grok `thought` events as reasoning-summary deltas and sanitizes tool lifecycle events without retaining `rawInput` or `rawOutput`.

## Cursor CLI

Use the Cursor debug wrapper for print-mode execution:

```bash
GITHUB_DELIVERY_DEBUG_TRACE=1 node scripts/cursor-with-debug-trace.mjs "inspect this repository"
```

The wrapper owns these flags:

```text
--print
--output-format stream-json
--stream-partial-output
```

Thinking deltas and sanitized tool lifecycle events are normalized into the shared trace schema.

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
