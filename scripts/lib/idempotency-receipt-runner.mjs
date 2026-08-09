import {
  exactIdempotencyRecordMatches,
  markerCandidates,
  readAuthenticatedActor,
} from "./idempotency-receipt.mjs";

const SOCIAL_IDEMPOTENT_ACTIONS = new Set([
  "post_review",
  "post_comment",
  "post_issue_comment",
  "reply_bot_thread",
  "reply_human_thread",
  "create_follow_up_issue",
  "post_resolution_record",
]);

function isIdempotencyCollectionRead(command, args) {
  return (
    command === "gh" &&
    args?.[0] === "api" &&
    args.includes("--paginate") &&
    args.includes("--slurp")
  );
}

function normalizePages(payload) {
  if (!Array.isArray(payload)) throw new Error("idempotency_lookup_invalid_payload");
  return payload.length > 0 && payload.every(Array.isArray) ? payload : [payload];
}

export function makeIdempotencyReceiptRunner({ request, runner } = {}) {
  if (typeof runner !== "function") throw new Error("idempotency_receipt_runner_required");
  if (!SOCIAL_IDEMPOTENT_ACTIONS.has(String(request?.action || ""))) return runner;

  let actorLogin = null;
  return function idempotencyReceiptRunner(command, args, options) {
    const result = runner(command, args, options);
    if (result?.status !== 0 || !isIdempotencyCollectionRead(command, args)) return result;

    let payload;
    try {
      payload = JSON.parse(String(result.stdout || "[]"));
    } catch {
      return result;
    }
    const pages = normalizePages(payload);
    const records = pages.flat();
    const candidates = markerCandidates(records, request?.idempotencyMarker);
    if (!candidates.length) return result;

    actorLogin ||= readAuthenticatedActor(runner);
    const filtered = pages.map((page) =>
      page.filter((record) => {
        if (!String(record?.body || "").includes(String(request.idempotencyMarker || ""))) {
          return true;
        }
        return exactIdempotencyRecordMatches({ record, request, actorLogin });
      }),
    );
    return {
      ...result,
      stdout: JSON.stringify(filtered),
    };
  };
}
