import { assertPublishedMarkdown } from "./published-body-integrity.mjs";

function runJson(runner, command, errorCode) {
  const [executable, ...args] = command;
  const result = runner(executable, args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result?.status !== 0) {
    const detail = String(result?.stderr || result?.stdout || "").trim();
    throw new Error(`${errorCode}:${detail || result?.status || "unknown"}`);
  }
  try {
    const value = JSON.parse(String(result?.stdout || "{}"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not_object");
    return value;
  } catch {
    throw new Error(`${errorCode}:invalid_json`);
  }
}

function commentIdFromReceipt(request, receipt) {
  const direct = receipt.existingMutation?.id || receipt.verification?.id || request.commentId;
  if (direct) return String(direct);
  const url = String(
    receipt.existingMutation?.html_url ||
      receipt.existingMutation?.url ||
      receipt.verification?.html_url ||
      receipt.verification?.url ||
      receipt.stdout ||
      "",
  );
  const match = url.match(/comments\/(\d+)/i);
  return match ? match[1] : null;
}

export function verifyLegacyMutationPostcondition({ request = {}, receipt = {}, runner } = {}) {
  if (receipt?.executed !== true || receipt?.status !== "succeeded") return null;
  if (typeof runner !== "function") throw new Error("postcondition_runner_required");

  const repo = String(request.repo || "");
  if (!repo) throw new Error("postcondition_repo_required");

  if (
    request.action === "post_comment" ||
    request.action === "post_issue_comment" ||
    request.action === "edit_own_comment" ||
    request.action === "reply_review_thread"
  ) {
    const expected = String(request.body || "");
    const commentId = commentIdFromReceipt(request, receipt);
    if (!commentId) {
      assertPublishedMarkdown(expected);
      return { body: expected, source: "request" };
    }
    const endpoint =
      request.action === "reply_review_thread"
        ? ["gh", "api", `repos/${repo}/pulls/comments/${commentId}`]
        : ["gh", "api", `repos/${repo}/issues/comments/${commentId}`];
    const comment = runJson(runner, endpoint, "comment_body_postcondition_failed");
    assertPublishedMarkdown(comment.body, { expected });
    return { body: comment.body, id: comment.id ?? commentId };
  }

  if (request.action === "close_pr") {
    const state = runJson(
      runner,
      ["gh", "pr", "view", String(request.pr), "--repo", repo, "--json", "state,closedAt"],
      "close_pr_postcondition_failed",
    );
    if (String(state.state || "").toUpperCase() !== "CLOSED" || !state.closedAt) {
      throw new Error("close_pr_postcondition_failed:not_closed");
    }
    return { state: "CLOSED", closedAt: state.closedAt };
  }

  if (request.action === "close_linked_issue") {
    const state = runJson(
      runner,
      ["gh", "issue", "view", String(request.issue), "--repo", repo, "--json", "state"],
      "close_issue_postcondition_failed",
    );
    if (String(state.state || "").toUpperCase() !== "CLOSED") {
      throw new Error("close_issue_postcondition_failed:not_closed");
    }
    return { state: "CLOSED" };
  }

  if (request.action === "change_draft_state") {
    const state = runJson(
      runner,
      ["gh", "pr", "view", String(request.pr), "--repo", repo, "--json", "isDraft,headRefOid"],
      "draft_state_postcondition_failed",
    );
    const expectedDraft = request.ready === false;
    if (state.isDraft !== expectedDraft) {
      throw new Error(
        `draft_state_postcondition_failed: expected isDraft=${expectedDraft}, observed ${String(state.isDraft)}`,
      );
    }
    if (
      request.expectedHead &&
      String(state.headRefOid || "").toLowerCase() !== String(request.expectedHead).toLowerCase()
    ) {
      throw new Error("draft_state_postcondition_failed:head_moved");
    }
    return { isDraft: state.isDraft, headRefOid: state.headRefOid || null };
  }

  return null;
}

