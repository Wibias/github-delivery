import { parseWorkflowSecurityYaml } from "./workflow-yaml-security.mjs";

const GITHUB_ACTIONS_APP_ID = 15368;
const RUN_ID_RE = /\/actions\/runs\/(\d+)(?:\/|$)/;

function appId(row) {
  const value = row?.app?.id ?? row?.app?.databaseId ?? row?.app_id;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function splitFlowItems(value) {
  const text = String(value || "").trim();
  const body = text.slice(1, -1);
  const items = [];
  let single = false;
  let double = false;
  let start = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === "'" && !double) {
      if (single && body[index + 1] === "'") {
        index += 1;
        continue;
      }
      single = !single;
    } else if (char === '"' && !single && body[index - 1] !== "\\") {
      double = !double;
    } else if (char === "," && !single && !double) {
      items.push(body.slice(start, index).trim());
      start = index + 1;
    }
  }
  items.push(body.slice(start).trim());
  return items.filter(Boolean);
}

function decodeFlowScalar(value) {
  const text = String(value || "").trim();
  if (text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (text.startsWith('"') && text.endsWith('"')) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  return text;
}

function flowValueContainsEvent(value, eventName) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (text.startsWith("[") && text.endsWith("]")) {
    return splitFlowItems(text).some((item) => decodeFlowScalar(item) === eventName);
  }
  if (text.startsWith("{") && text.endsWith("}")) {
    return splitFlowItems(text).some((item) => {
      const colon = item.indexOf(":");
      if (colon < 0) return false;
      return decodeFlowScalar(item.slice(0, colon)) === eventName;
    });
  }
  return decodeFlowScalar(text) === eventName;
}

export function workflowHasTopLevelEvent(source = "", eventName = "") {
  const event = String(eventName || "").trim();
  if (!event) return false;
  const parsed = parseWorkflowSecurityYaml(source);
  if (parsed.errors.length) return false;

  const onIndex = parsed.records.findIndex(
    (row) => row.indent === 0 && row.key === "on",
  );
  if (onIndex < 0) return false;
  const on = parsed.records[onIndex];
  if (on.value) return flowValueContainsEvent(on.value, event);

  const descendants = [];
  for (let index = onIndex + 1; index < parsed.records.length; index += 1) {
    const row = parsed.records[index];
    if (row.indent <= on.indent) break;
    descendants.push(row);
  }
  if (!descendants.length) return false;
  const directIndent = Math.min(...descendants.map((row) => row.indent));
  return descendants.some((row) => row.indent === directIndent && row.key === event);
}

export function workflowRunIdFromCheckRun(row) {
  const match = String(row?.details_url || row?.html_url || "").match(RUN_ID_RE);
  return match ? Number(match[1]) : null;
}

export function requiredGithubActionsDescriptors(descriptors = []) {
  return descriptors.filter((descriptor) => Number(descriptor?.appId) === GITHUB_ACTIONS_APP_ID);
}

export function evaluateRequiredCheckWorkflowMapping({
  descriptors = [],
  checkRuns = [],
  workflowRunPaths = {},
  workflowTexts = {},
} = {}) {
  const required = requiredGithubActionsDescriptors(descriptors);
  const mappings = [];
  const unmapped = [];

  for (const descriptor of required) {
    const candidates = checkRuns.filter(
      (row) => row?.name === descriptor.context && appId(row) === GITHUB_ACTIONS_APP_ID,
    );
    if (candidates.length !== 1) {
      unmapped.push({
        context: descriptor.context,
        reason: candidates.length ? "producer_ambiguous" : "producer_missing",
      });
      continue;
    }
    const runId = workflowRunIdFromCheckRun(candidates[0]);
    if (!runId) {
      unmapped.push({ context: descriptor.context, reason: "workflow_run_id_missing" });
      continue;
    }
    const workflowPath = workflowRunPaths[String(runId)] || workflowRunPaths[runId] || null;
    if (!workflowPath) {
      unmapped.push({ context: descriptor.context, runId, reason: "workflow_path_missing" });
      continue;
    }
    const text = workflowTexts[workflowPath];
    if (typeof text !== "string") {
      unmapped.push({
        context: descriptor.context,
        runId,
        workflowPath,
        reason: "workflow_source_missing",
      });
      continue;
    }
    const hasMergeGroupTrigger = workflowHasTopLevelEvent(text, "merge_group");
    mappings.push({
      context: descriptor.context,
      appId: GITHUB_ACTIONS_APP_ID,
      runId,
      workflowPath,
      hasMergeGroupTrigger,
    });
    if (!hasMergeGroupTrigger) {
      unmapped.push({
        context: descriptor.context,
        runId,
        workflowPath,
        reason: "merge_group_trigger_missing",
      });
    }
  }

  return {
    requiredGithubActionsCheckCount: required.length,
    requiredCheckWorkflowMappingComplete: unmapped.length === 0,
    mappings,
    unmapped,
  };
}
