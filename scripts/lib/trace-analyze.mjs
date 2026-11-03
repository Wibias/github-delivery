const DISCOVERY_TYPES = new Set([
  "grep",
  "read_file",
  "search",
  "search_files",
  "find",
  "find_in_files",
  "glob",
  "list_dir",
  "list_files",
  "code_search",
  "webSearch",
]);
const MUTATION_TYPES = new Set([
  "search_replace",
  "write_file",
  "create_file",
  "delete_file",
  "apply_patch",
  "edit_file",
  "multi_edit",
  "replace_file",
  "insert",
  "fileChange",
]);
const POLLING_TYPES = new Set(["get_command_or_subagent_output"]);
const USAGE_KEYS = [
  "inputTokens",
  "cachedInputTokens",
  "cacheCreationInputTokens",
  "outputTokens",
  "reasoningTokens",
  "totalTokens",
];

function duplicateCount(events, key) {
  const counts = new Map();
  for (const event of events) {
    const value = event?.[key];
    if (typeof value !== "string" || value.length === 0) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  let duplicates = 0;
  for (const count of counts.values()) duplicates += Math.max(0, count - 1);
  return duplicates;
}

function timeMs(event) {
  const value = Date.parse(event?.timestamp || "");
  return Number.isFinite(value) ? value : null;
}

function addUsage(target, source) {
  if (!source || typeof source !== "object") return;
  for (const key of USAGE_KEYS) {
    if (Number.isFinite(source[key]) && source[key] >= 0) {
      target[key] = (target[key] || 0) + Math.round(source[key]);
    }
  }
}

function traceUsage(events) {
  let invocation = null;
  for (const event of events) {
    if (event?.type === "turn_completed" && event?.usage && event?.usageScope === "invocation") {
      invocation = event.usage;
    }
  }
  if (invocation) {
    const result = {};
    for (const key of USAGE_KEYS) {
      if (Number.isFinite(invocation[key]) && invocation[key] >= 0) {
        result[key] = Math.round(invocation[key]);
      }
    }
    return result;
  }

  const total = {};
  for (const event of events) {
    if (event?.type === "turn_completed") addUsage(total, event?.usage);
  }
  return total;
}

function serialDiscoveryChains(starts) {
  let chains = 0;
  let chain = [];

  function flush() {
    const turns = new Set(chain.map((event) => event.turnId).filter(Boolean));
    if (chain.length >= 3 && turns.size >= 3) chains += 1;
    chain = [];
  }

  for (const event of starts) {
    if (!DISCOVERY_TYPES.has(event.itemType)) {
      flush();
      continue;
    }
    if (chain.length > 0) {
      const previous = chain[chain.length - 1];
      const previousTime = timeMs(previous);
      const currentTime = timeMs(event);
      const gap = previousTime !== null && currentTime !== null
        ? currentTime - previousTime
        : null;
      if (gap === null || gap < 0 || gap > 15_000) flush();
    }
    chain.push(event);
  }
  flush();
  return chains;
}

function isMutation(event) {
  return MUTATION_TYPES.has(event?.itemType) || event?.toolEffect === "state-change";
}

function flag(code, level, label, detail = null) {
  return { code, level, label, ...(detail ? { detail } : {}) };
}

export function analyzeTraceEvents(events = []) {
  const input = Array.isArray(events)
    ? events.filter((event) => event && typeof event === "object")
    : [];
  const starts = input.filter((event) => event.type === "item_started");
  const completed = input.filter((event) => event.type === "item_completed");
  const toolCalls = starts.length;
  const failedToolCalls = completed.filter((event) => event.outcome === "failed").length;
  const duplicateArgumentCalls = duplicateCount(starts, "argumentFingerprint");
  const targetFingerprintCalls = starts.filter(
    (event) => typeof event.targetFingerprint === "string" && event.targetFingerprint.length > 0,
  ).length;
  const repeatedTargetCalls = targetFingerprintCalls > 0
    ? duplicateCount(starts, "targetFingerprint")
    : null;
  const duplicateResultCalls = duplicateCount(completed, "resultFingerprint");
  const pollingCalls = starts.filter((event) => POLLING_TYPES.has(event.itemType)).length;
  const publicationAttempts = starts.filter(
    (event) => event.publicationAction === "pr_create",
  ).length;
  const serialChains = serialDiscoveryChains(starts);
  const usage = traceUsage(input);

  const validTimes = input.map(timeMs).filter((value) => value !== null);
  const firstTime = validTimes.length > 0 ? validTimes[0] : null;
  const lastTime = validTimes.length > 0 ? validTimes[validTimes.length - 1] : null;
  const durationMs = firstTime !== null && lastTime !== null
    ? Math.max(0, lastTime - firstTime)
    : 0;

  let finalMutation = null;
  for (const event of starts) {
    if (isMutation(event)) finalMutation = event;
  }
  const finalMutationTime = finalMutation ? timeMs(finalMutation) : null;
  const afterFinalMutation = finalMutationTime === null
    ? []
    : starts.filter((event) => {
        const timestamp = timeMs(event);
        return timestamp !== null && timestamp > finalMutationTime;
      });
  const postFinalMutation = {
    durationMs: finalMutationTime !== null && lastTime !== null
      ? Math.max(0, lastTime - finalMutationTime)
      : 0,
    toolCalls: afterFinalMutation.length,
    mutations: afterFinalMutation.filter((event) => isMutation(event)).length,
  };

  const flags = [];
  const inputTokens = usage.inputTokens || 0;
  const cachedTokens = usage.cachedInputTokens || 0;
  const churnRatio = inputTokens > 0 ? cachedTokens / inputTokens : 0;
  if (churnRatio >= 10) {
    flags.push(flag(
      "context_churn",
      "HIGH",
      "context churn",
      `${churnRatio.toFixed(1)}x cached/fresh input`,
    ));
  } else if (churnRatio >= 3) {
    flags.push(flag(
      "context_churn",
      "MED",
      "context churn",
      `${churnRatio.toFixed(1)}x cached/fresh input`,
    ));
  }
  if (serialChains > 0) {
    flags.push(flag(
      "serial_discovery",
      serialChains >= 3 ? "HIGH" : "MED",
      "serial discovery",
    ));
  }
  if (pollingCalls >= 4) {
    flags.push(flag("subagent_polling", "MED", "subagent polling"));
  } else if (pollingCalls >= 2) {
    flags.push(flag("subagent_polling", "LOW", "subagent polling"));
  }
  if (
    postFinalMutation.toolCalls >= 5
    && postFinalMutation.mutations === 0
    && postFinalMutation.durationMs >= 60_000
  ) {
    flags.push(flag("verification_tail", "MED", "verification tail"));
  }

  return {
    durationMs,
    toolCalls,
    failedToolCalls,
    duplicateArgumentCalls,
    duplicateResultCalls,
    targetFingerprintCalls,
    repeatedTargetCalls,
    pollingCalls,
    publicationAttempts,
    serialDiscoveryChains: serialChains,
    postFinalMutation,
    usage,
    flags,
  };
}

function formatDuration(ms) {
  const seconds = Math.round((ms || 0) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${String(rest).padStart(2, "0")}s`;
}

function row(label, value) {
  return `${label.padEnd(28)} ${value}\n`;
}

export function renderTraceAnalysis(analysis) {
  let output = "Trace efficiency analysis\n\n";
  output += row("Duration", formatDuration(analysis.durationMs));
  output += row("Tool calls", analysis.toolCalls);
  output += row("Failed tool calls", analysis.failedToolCalls);
  output += row("Potential duplicate calls", analysis.duplicateArgumentCalls);
  output += row(
    "Target fingerprint coverage",
    `${analysis.targetFingerprintCalls || 0}/${analysis.toolCalls || 0} (${analysis.toolCalls > 0 ? (((analysis.targetFingerprintCalls || 0) / analysis.toolCalls) * 100).toFixed(1) : "0.0"}%)`,
  );
  output += row(
    "Repeated targets",
    analysis.repeatedTargetCalls === null
      ? "n/a (no target fingerprints)"
      : analysis.repeatedTargetCalls,
  );
  output += row("Duplicate results", analysis.duplicateResultCalls);
  output += row("PR publication attempts", analysis.publicationAttempts || 0);
  output += row("Serial discovery chains", analysis.serialDiscoveryChains);
  output += row("Polling calls", analysis.pollingCalls);
  output += "\nToken usage\n";
  output += row("Fresh input tokens", analysis.usage.inputTokens || 0);
  output += row("Cached input tokens", analysis.usage.cachedInputTokens || 0);
  output += row("Output tokens", analysis.usage.outputTokens || 0);
  output += "\nPost-final-edit work\n";
  output += row("Duration", formatDuration(analysis.postFinalMutation.durationMs));
  output += row("Tool calls", analysis.postFinalMutation.toolCalls);
  output += row("Mutations", analysis.postFinalMutation.mutations);
  output += "\nFlags\n";
  if (analysis.flags.length === 0) output += "  none\n";
  for (const entry of analysis.flags) {
    output += `  ${entry.level.padEnd(5)} ${entry.label}${entry.detail ? ` (${entry.detail})` : ""}\n`;
  }
  return output;
}

export function parseTraceJsonl(value) {
  return String(value || "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`invalid_trace_jsonl_line:${index + 1}:${error?.message || error}`);
      }
    });
}
