const VOLATILE_NAME = /(checks?|workflow|runs?|status|mergeable|pull_request|pr_|queue|jobs?)/i;
const EVIDENCE_NAME = /(?:^|__|_)(fetch|get|list|search|read|view|status|diff|compare|find|inspect|lookup|show|logs?|checks?)(?:_|$)/i;
const STATE_CHANGE_NAME = /(?:^|__|_)(create|update|delete|remove|merge|reply|push|close|reopen|mark|set|add|apply|write|edit|patch|commit|move|rename|archive|restore|publish)(?:_|$)/i;
const DELEGATE_NAME = /(?:^|__|_)(agent|spawn_agent|delegate|collab)(?:_|$)/i;

function commandText(command) {
  if (Array.isArray(command)) return command.join(" ");
  return String(command || "").trim();
}

function classifyCommand(command) {
  const raw = commandText(command);
  const value = raw.toLowerCase();
  if (!value) return { kind: "neutral" };

  if (/\bgh\s+(?:pr\s+(?:checks|view|diff)|run\s+(?:view|list)|api\b)/i.test(value)) {
    return { kind: "evidence", volatility: "volatile" };
  }

  if (
    /^(?:get-content\b|select-string\b|rg\b|grep\b|cat\b|head\b|tail\b|findstr\b|type\b|ls\b|dir\b|pwd\b|git\s+(?:status|diff|log|show|branch|rev-parse)\b)/i.test(
      value,
    )
  ) {
    return { kind: "evidence", volatility: "stable" };
  }

  if (
    /\b(?:git\s+(?:commit|push|merge|rebase|checkout|switch|reset|restore|clean|add|rm|mv)|gh\s+(?:pr\s+(?:create|edit|merge|ready|close|reopen)|issue\s+(?:create|edit|close|reopen)|release\s+(?:create|edit|delete)))\b/i.test(
      value,
    )
  ) {
    return { kind: "state-change" };
  }

  if (
    /(?:^|[;&|]\s*|\b)(?:npm|pnpm|yarn)\s+(?:test|run\s+(?:test|check|lint|build|typecheck|verify))\b|\b(?:node\s+--test|pytest|cargo\s+(?:test|check|build|clippy)|go\s+test|dotnet\s+(?:test|build)|mvn\s+test|gradle\s+test)\b/i.test(
      value,
    )
  ) {
    return { kind: "execution" };
  }

  return { kind: "neutral" };
}

export function classifyHookTool(input = {}) {
  const name = String(input.tool_name || input.toolName || "");
  const toolInput = input.tool_input ?? input.toolInput ?? {};

  if (name === "Bash" || /(?:^|__)shell(?:_|$)/i.test(name)) {
    return classifyCommand(toolInput?.command);
  }
  if (/^(?:apply_patch|Edit|Write)$/i.test(name)) return { kind: "state-change" };
  if (name === "Agent" || DELEGATE_NAME.test(name)) return { kind: "delegate" };
  if (STATE_CHANGE_NAME.test(name)) return { kind: "state-change" };
  if (EVIDENCE_NAME.test(name)) {
    return {
      kind: "evidence",
      volatility: VOLATILE_NAME.test(name) ? "volatile" : "stable",
    };
  }
  return { kind: "neutral" };
}

function appServerToolName(item) {
  return (
    item?.appContext?.actionName ||
    item?.toolName ||
    item?.tool ||
    item?.name ||
    item?.server ||
    ""
  );
}

export function classifyAppServerItem(item = {}) {
  switch (item?.type) {
    case "webSearch":
    case "imageView":
      return { kind: "evidence", volatility: "volatile" };
    case "fileChange":
      return { kind: "state-change" };
    case "commandExecution":
      return classifyCommand(item.command ?? item.commandText ?? item.process?.command);
    case "mcpToolCall":
    case "dynamicToolCall":
      return classifyHookTool({
        tool_name: appServerToolName(item),
        tool_input: item.arguments ?? item.input ?? {},
      });
    case "collabToolCall":
      return { kind: "delegate" };
    default:
      return { kind: "neutral" };
  }
}

export function isSuccessfulAppServerItem(item = {}) {
  const status = String(item?.status || "").toLowerCase();
  return !["failed", "error", "cancelled", "canceled", "declined", "rejected"].includes(status);
}
