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

export function verifyLegacyMutationPostcondition({ request = {}, receipt = {}, runner } = {}) {
  if (receipt?.executed !== true || receipt?.status !== "succeeded") return null;
  if (typeof runner !== "function") throw new Error("postcondition_runner_required");

  const repo = String(request.repo || "");
  if (!repo) throw new Error("postcondition_repo_required");

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
