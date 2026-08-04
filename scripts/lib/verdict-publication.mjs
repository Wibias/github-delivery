import { spawnSync } from "node:child_process";

const MARKER_ANCHOR =
  /github-delivery:full-review-verdict\s+run:([^\s]+)\s+head:([^\s]+)/;

export function findVerdictPublication({ comments = [], runId, head }) {
  const expectedRun = String(runId || "");
  const expectedHead = String(head || "");
  if (!expectedRun || !expectedHead) return null;
  for (const comment of comments) {
    const body = typeof comment?.body === "string" ? comment.body : "";
    const match = body.match(MARKER_ANCHOR);
    if (match && match[1] === expectedRun && match[2] === expectedHead) {
      return comment;
    }
  }
  return null;
}

export function fetchPrConversationComments({ repo, pr }) {
  const comments = [];
  let page = 1;
  for (;;) {
    const result = spawnSync(
      "gh",
      [
        "api",
        `repos/${repo}/issues/${pr}/comments?per_page=100&page=${page}`,
        "--jq",
        ".",
      ],
      { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
    );
    if (result.status !== 0) {
      const detail = (result.stderr || result.stdout || "").trim();
      throw new Error(detail || `gh failed (${result.status})`);
    }
    const batch = JSON.parse(result.stdout || "[]");
    comments.push(...batch);
    if (batch.length < 100) return comments;
    page += 1;
  }
}
