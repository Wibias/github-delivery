// Workflow/mutation-mode compatibility is the router's contract. A workflow
// declares the modes that may drive its gates; a stricter self-selected mode
// is a workflow violation, never a publication excuse.

const WORKFLOW_MUTATION_MODES = Object.freeze({
  "references/consolidate-prs.md": ["read-only"],
  "references/create-pr-for-issue.md": ["maintainer"],
  "references/create-pr-from-local-work.md": ["maintainer"],
  "references/fix-pr-bots.md": ["maintainer"],
  "references/full-review-pr.md": ["review", "maintainer"],
  "references/merge-pr.md": ["maintainer"],
  "references/multi-base-delivery.md": ["maintainer"],
  "references/open-work-status.md": ["read-only"],
  "references/overtake-pr.md": ["maintainer"],
  "references/re-review-pr.md": ["review"],
  "references/research-issue.md": ["review"],
  "references/security-review.md": ["review"],
  "references/simplify-pr.md": ["maintainer"],
  "references/status.md": ["read-only"],
  "references/supersede-pr.md": ["maintainer"],
  "references/watch-pr.md": ["read-only", "autonomous"],
  "references/work-item-delivery.md": ["read-only", "maintainer"],
});

export function allowedMutationModes(workflow) {
  return WORKFLOW_MUTATION_MODES[workflow] || null;
}

export function validateWorkflowMutationMode({ workflow, mutationMode }) {
  const mode = String(mutationMode ?? "read-only").toLowerCase();
  const allowedModes = allowedMutationModes(workflow);
  if (!allowedModes) {
    return {
      valid: false,
      workflow,
      mutationMode: mode,
      allowedModes: [],
      reason: "unknown_workflow",
    };
  }
  if (!allowedModes.includes(mode)) {
    return {
      valid: false,
      workflow,
      mutationMode: mode,
      allowedModes,
      reason: "mode_denied_by_workflow",
    };
  }
  return {
    valid: true,
    workflow,
    mutationMode: mode,
    allowedModes,
    reason: null,
  };
}
