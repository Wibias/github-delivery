import { assertPublishedMarkdown } from "./published-body-integrity.mjs";

const LIVE_BODY_ACTIONS = new Set([
  "post_review",
  "post_comment",
  "post_issue_comment",
  "edit_own_comment",
  "reply_bot_thread",
  "reply_human_thread",
  "post_resolution_record",
]);

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

function runCollection(runner, command, errorCode) {
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
    const value = JSON.parse(String(result?.stdout || "[]"));
    if (!Array.isArray(value)) throw new Error("not_array");
    return value.flatMap((page) => (Array.isArray(page) ? page : [page]));
  } catch {
    throw new Error(`${errorCode}:invalid_json`);
  }
}

function receiptObjectId(receipt, kind) {
  const direct = receipt.existingMutation?.id || receipt.verification?.id;
  if (direct) return String(direct);

  const stdout = String(receipt.stdout || "").trim();
  if (stdout.startsWith("{") && stdout.endsWith("}")) {
    try {
      const parsed = JSON.parse(stdout);
      if (parsed?.id) return String(parsed.id);
    } catch {
      // Fall through to URL parsing and authoritative collection lookup.
    }
  }

  const url = String(
    receipt.existingMutation?.html_url ||
      receipt.existingMutation?.url ||
      receipt.verification?.html_url ||
      receipt.verification?.url ||
      receipt.stdout ||
      "",
  );
  const pattern = kind === "review" ? /reviews\/(\d+)/i : /comments\/(\d+)/i;
  const match = url.match(pattern);
  return match ? match[1] : null;
}

function directBodyCommand(request, receipt) {
  if (request.action === "edit_own_comment") {
    return ["gh", "api", `repos/${request.repo}/issues/comments/${request.commentId}`];
  }

  const kind = request.action === "post_review" ? "review" : "comment";
  const objectId = receiptObjectId(receipt, kind);
  if (!objectId) return null;
  if (request.action === "post_review") {
    return ["gh", "api", `repos/${request.repo}/pulls/${request.pr}/reviews/${objectId}`];
  }
  if (request.action === "reply_bot_thread" || request.action === "reply_human_thread") {
    return ["gh", "api", `repos/${request.repo}/pulls/comments/${objectId}`];
  }
  return ["gh", "api", `repos/${request.repo}/issues/comments/${objectId}`];
}

function bodyCollectionCommand(request) {
  switch (request.action) {
    case "post_comment":
    case "post_resolution_record":
      return [
        "gh",
        "api",
        `repos/${request.repo}/issues/${request.pr}/comments?per_page=100`,
        "--paginate",
        "--slurp",
      ];
    case "post_issue_comment":
      return [
        "gh",
        "api",
        `repos/${request.repo}/issues/${request.issue}/comments?per_page=100`,
        "--paginate",
        "--slurp",
      ];
    case "reply_bot_thread":
    case "reply_human_thread":
      return [
        "gh",
        "api",
        `repos/${request.repo}/pulls/${request.pr}/comments?per_page=100`,
        "--paginate",
        "--slurp",
      ];
    case "post_review":
      return [
        "gh",
        "api",
        `repos/${request.repo}/pulls/${request.pr}/reviews?per_page=100`,
        "--paginate",
        "--slurp",
      ];
    default:
      return null;
  }
}

function findPublishedBody(request, receipt, runner) {
  const direct = directBodyCommand(request, receipt);
  if (direct) {
    return runJson(runner, direct, "published_body_postcondition_failed");
  }

  const collection = bodyCollectionCommand(request);
  if (!collection) throw new Error("published_body_postcondition_failed:target_unavailable");
  const marker = String(request.idempotencyMarker || "");
  if (!marker) throw new Error("published_body_postcondition_failed:idempotency_marker_required");
  const actor = String(
    runJson(runner, ["gh", "api", "user"], "published_body_actor_failed").login || "",
  ).toLowerCase();
  if (!actor) throw new Error("published_body_actor_failed:login_missing");

  const candidates = runCollection(
    runner,
    collection,
    "published_body_collection_failed",
  ).filter((record) => {
    if (!String(record?.body || "").includes(marker)) return false;
    if (String(record?.user?.login || "").toLowerCase() !== actor) return false;
    if (
      request.action === "reply_bot_thread" ||
      request.action === "reply_human_thread"
    ) {
      return Number(record?.in_reply_to_id) === Number(request.commentId);
    }
    return true;
  });

  if (candidates.length === 0) {
    throw new Error("published_body_postcondition_failed:not_found");
  }
  if (candidates.length !== 1) {
    throw new Error("published_body_postcondition_failed:ambiguous");
  }
  return candidates[0];
}

export function verifyLegacyMutationPostcondition({ request = {}, receipt = {}, runner } = {}) {
  if (receipt?.executed !== true || receipt?.status !== "succeeded") return null;
  if (typeof runner !== "function") throw new Error("postcondition_runner_required");

  const repo = String(request.repo || "");
  if (!repo) throw new Error("postcondition_repo_required");

  if (LIVE_BODY_ACTIONS.has(request.action)) {
    const expected = String(request.body || "");
    const published = findPublishedBody(request, receipt, runner);
    assertPublishedMarkdown(published.body, { expected });
    return {
      body: published.body,
      id: published.id ?? null,
      source: "github",
    };
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
    const pr = Number(request.pr);
    if (!Number.isInteger(pr) || pr <= 0) {
      throw new Error("close_issue_postcondition_failed:pr_required");
    }
    const link = runJson(
      runner,
      ["gh", "pr", "view", String(pr), "--repo", repo, "--json", "closingIssues"],
      "close_issue_postcondition_failed",
    );
    const numbers = Array.isArray(link.closingIssues)
      ? link.closingIssues.map((row) => Number(row?.number))
      : [];
    if (!numbers.includes(Number(request.issue))) {
      throw new Error("close_issue_postcondition_failed:not_linked");
    }
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
