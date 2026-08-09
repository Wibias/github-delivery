const GITHUB_ACTIONS_APP_ID = 15368;
const RUN_ID_RE = /\/actions\/runs\/(\d+)(?:\/|$)/;

function appId(row) {
  const value = row?.app?.id ?? row?.app?.databaseId ?? row?.app_id;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
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
    const hasMergeGroupTrigger = /\bmerge_group\b/.test(text);
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
