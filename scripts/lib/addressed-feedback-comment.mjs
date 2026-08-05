export const ADDRESSED_FEEDBACK_INLINE_MAX = 5;

export function formatAddressedFeedbackComment({
  feedbackKeys = [],
  commitRef = "<7-40 character PR commit SHA>",
  headOid = null,
} = {}) {
  const uniqueKeys = [...new Set(feedbackKeys.filter(Boolean))];
  const lines = ["[GD] Addressed feedback", ""];

  if (uniqueKeys.length <= ADDRESSED_FEEDBACK_INLINE_MAX) {
    lines.push("feedbacks:", ...uniqueKeys.map((key) => "- " + key), "", "commit: " + commitRef, "");
  } else {
    lines.push(
      "commit: " + commitRef,
      "",
      "<details>",
      "<summary>feedbacks:</summary>",
      "",
      ...uniqueKeys.map((key) => "- " + key),
      "",
      "</details>",
      "",
    );
  }

  if (headOid) {
    lines.push("<!-- gd:addressed-feedback head:" + headOid + " -->");
  }

  return lines.join("\n");
}
