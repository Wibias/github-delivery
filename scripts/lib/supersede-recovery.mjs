export function planSupersedeRecovery({ obsoleteState, supersedeNotePresent = false } = {}) {
  const state = String(obsoleteState || "").toUpperCase();
  if (state === "MERGED") {
    return { decision: "blocked", nextAction: null, reason: "obsolete_pr_already_merged" };
  }
  if (state === "OPEN") {
    return { decision: "continue", nextAction: "close_pr", reason: "obsolete_pr_still_open" };
  }
  if (state === "CLOSED" && !supersedeNotePresent) {
    return { decision: "continue", nextAction: "post_comment", reason: "close_applied_note_missing" };
  }
  if (state === "CLOSED" && supersedeNotePresent) {
    return { decision: "complete", nextAction: null, reason: null };
  }
  return { decision: "unknown", nextAction: null, reason: "obsolete_pr_state_unknown" };
}
