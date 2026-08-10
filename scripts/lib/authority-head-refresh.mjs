// GitHub commit SHAs are 40 hex characters. The broker treats expectedHead as
// an opaque string, so accept any full hex string of at least 40 characters.
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
 * authorize step refreshes the live head before asking for approval so the
 * user approves the exact current head instead of a stale one.
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
    "headRefOid",
    "--jq",
    ".headRefOid",
  ]);
  if (typeof output !== "string") {
    throw new Error("authority_head_refresh_invalid_output");
  }
  const head = output.trim();
  if (!SHA_RE.test(head)) {
    throw new Error("authority_head_refresh_invalid_head");
  }
  return head;
}

/**
 * Refresh the `expectedHead` of every PR-scoped operation against the live
 * GitHub head before the authorization prompt. Operations without a PR head
 * binding are returned unchanged. A failed read fails closed before any
 * approval prompt.
 *
 * Returns `{ requests, refreshed }` where `refreshed` is an array of
 * `{ index, pr, repo, from, to }` entries for every operation whose expected
 * head was updated.
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
    if (String(observed).toLowerCase() !== String(request.expectedHead).toLowerCase()) {
      refreshed.push({
        index,
        pr: request.pr,
        repo: request.repo,
        from: String(request.expectedHead),
        to: observed,
      });
      output[index] = {
        ...output[index],
        expectedHead: observed,
      };
    }
  }
  return { requests: output, refreshed };
}
