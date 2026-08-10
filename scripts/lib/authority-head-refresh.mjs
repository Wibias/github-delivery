// GitHub commit SHAs are 40 hex characters today. Keep the existing >=40
// compatibility so this pre-approval binding does not assume a forever-SHA1
// repository format.
const SHA_RE = /^[0-9a-f]{40,}$/i;

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${name}_invalid`);
  }
  return number;
}

/**
 * Actions whose grant scope binds a PR `expectedHead`. For these, the
 * authorize step refreshes both the live head and live head branch before
 * asking for approval so the signed scope can bind the exact branch too.
 */
const PR_HEAD_SCOPED_ACTIONS = new Set([
  "post_review",
  "post_comment",
  "edit_own_comment",
  "reply_bot_thread",
  "reply_human_thread",
  "resolve_thread",
  "resolve_bot_thread",
  "change_draft_state",
  "request_reviewers",
  "close_pr",
  "merge_pr",
  "retarget_pr",
  "post_resolution_record",
  "update_pr_body",
]);

export function headRefreshCandidate(request = {}) {
  return (
    PR_HEAD_SCOPED_ACTIONS.has(String(request.action || "")) &&
    request.pr !== undefined &&
    request.pr !== null &&
    request.expectedHead !== undefined &&
    request.expectedHead !== null
  );
}

function fetchLiveHead({ request, runner }) {
  const output = runner([
    "gh",
    "pr",
    "view",
    String(positiveInteger(request.pr, "pr")),
    "--repo",
    String(request.repo),
    "--json",
    "headRefOid,headRefName",
  ]);
  if (typeof output !== "string") {
    throw new Error("authority_head_refresh_invalid_output");
  }

  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("authority_head_refresh_invalid_output");
  }

  const head = typeof parsed?.headRefOid === "string" ? parsed.headRefOid.trim() : "";
  if (!SHA_RE.test(head)) {
    throw new Error("authority_head_refresh_invalid_head");
  }
  const branch = typeof parsed?.headRefName === "string" ? parsed.headRefName.trim() : "";
  if (!branch) {
    throw new Error("authority_head_refresh_invalid_branch");
  }
  return { head, branch };
}

/**
 * Refresh the `expectedHead` and bind `authorityBranch` for every PR-scoped
 * operation against live GitHub state before the authorization prompt.
 * Operations without a PR head binding are returned unchanged. A failed read
 * fails closed before any approval prompt.
 *
 * Returns `{ requests, refreshed }` where `refreshed` contains only operations
 * whose expected head moved. Branch identity is nevertheless bound to every
 * PR-scoped output request.
 */
export function refreshExpectedHeads({
  requests = [],
  runner = () => {
    throw new Error("authority_head_refresh_runner_required");
  },
} = {}) {
  const output = requests.map((request) => structuredClone(request));
  const refreshed = [];
  for (let index = 0; index < requests.length; index += 1) {
    const request = requests[index];
    if (!headRefreshCandidate(request)) continue;
    const observed = fetchLiveHead({ request, runner });
    output[index] = {
      ...output[index],
      expectedHead: observed.head,
      authorityBranch: observed.branch,
    };
    if (String(observed.head).toLowerCase() !== String(request.expectedHead).toLowerCase()) {
      refreshed.push({
        index,
        pr: request.pr,
        repo: request.repo,
        from: String(request.expectedHead),
        to: observed.head,
        branch: observed.branch,
      });
    }
  }
  return { requests: output, refreshed };
}
