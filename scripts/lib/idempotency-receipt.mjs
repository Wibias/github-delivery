const IDEMPOTENCY_MARKER_RE = /\n\n<!-- github-delivery:idempotency [0-9a-f]{64} -->\s*$/i;

function sameText(left, right) {
  return String(left ?? "").trimEnd() === String(right ?? "").trimEnd();
}

function sameRepo(left, right) {
  return String(left || "").toLowerCase() === String(right || "").toLowerCase();
}

function repoName(record, side) {
  return record?.[side]?.repo?.full_name ?? record?.[side]?.repo?.nameWithOwner ?? null;
}

export function visibleIdempotencyBody(value) {
  return String(value ?? "").replace(IDEMPOTENCY_MARKER_RE, "");
}

export function markerCandidates(records = [], marker) {
  const expected = String(marker || "");
  if (!expected) return [];
  return (Array.isArray(records) ? records : []).filter((record) =>
    String(record?.body || "").includes(expected),
  );
}

export function exactIdempotencyRecordMatches({ record, request, actorLogin } = {}) {
  if (!record || !request || !actorLogin) return false;
  const recordActor = String(record?.user?.login || "").toLowerCase();
  if (!recordActor || recordActor !== String(actorLogin).toLowerCase()) return false;

  const marker = String(request.idempotencyMarker || "");
  if (!marker || !String(record?.body || "").includes(marker)) return false;
  if (
    !sameText(
      visibleIdempotencyBody(record.body),
      visibleIdempotencyBody(request.body),
    )
  ) {
    return false;
  }

  switch (request.action) {
    case "create_issue":
    case "create_follow_up_issue":
      if (record.pull_request) return false;
      return sameText(record.title, request.title);
    case "create_pr": {
      if (record.pull_request === undefined && !record.head && !record.base) return false;
      if (!sameText(record.title, request.title)) return false;
      if (String(record?.base?.ref || "") !== String(request.base || "")) return false;

      const requestRepo = String(request.repo || "");
      const recordBaseRepo = repoName(record, "base");
      if (recordBaseRepo && requestRepo && !sameRepo(recordBaseRepo, requestRepo)) return false;

      const requestedHead = String(request.head || "").trim();
      const separator = requestedHead.indexOf(":");
      const requestedBranch = separator >= 0 ? requestedHead.slice(separator + 1) : requestedHead;
      const recordHead = String(record?.head?.ref || "");
      const recordLabel = String(record?.head?.label || "");
      if (!requestedBranch || recordHead !== requestedBranch) return false;
      if (separator >= 0 && recordLabel !== requestedHead) return false;

      const recordHeadRepo = repoName(record, "head");
      const requestedHeadRepo = String(request.headRepo || "").trim();
      if (requestedHeadRepo) {
        if (!recordHeadRepo || !sameRepo(recordHeadRepo, requestedHeadRepo)) return false;
      } else if (separator < 0 && requestRepo) {
        if (!recordHeadRepo || !sameRepo(recordHeadRepo, requestRepo)) return false;
      }
      return true;
    }
    case "reply_bot_thread":
    case "reply_human_thread":
      return Number(record.in_reply_to_id) === Number(request.commentId);
    default:
      return true;
  }
}

export function readAuthenticatedActor(runner) {
  if (typeof runner !== "function") throw new Error("idempotency_actor_runner_required");
  const result = runner("gh", ["api", "user", "--jq", ".login"], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result?.status !== 0) {
    const detail = String(result?.stderr || result?.stdout || "").trim();
    throw new Error(detail || `idempotency_actor_lookup_failed:${result?.status ?? "unknown"}`);
  }
  const login = String(result?.stdout || "").trim();
  if (!login) throw new Error("idempotency_actor_missing");
  return login;
}
