import {
  createAgentDebugTraceRecorder,
  debugTraceEnabled,
} from "./agent-debug-trace.mjs";

const CODEX_TRACE_KIND = "github-delivery/codex-debug-trace-event";

export { debugTraceEnabled };

export function createCodexDebugTraceRecorder(options = {}) {
  return createAgentDebugTraceRecorder({
    ...options,
    provider: "codex",
    traceKind: CODEX_TRACE_KIND,
  });
}
