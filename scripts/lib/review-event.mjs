const ALLOWED_REVIEW_EVENTS = new Set(["comment", "request-changes"]);

export function reviewEventOf(request = {}) {
  const raw = request.event;
  if (raw === undefined || raw === null || raw === "") return "comment";
  if (typeof raw !== "string") throw new Error("review_event_invalid");
  if (raw === "approve") throw new Error("review_event_approve_forbidden");
  if (!ALLOWED_REVIEW_EVENTS.has(raw)) throw new Error("review_event_invalid");
  return raw;
}
