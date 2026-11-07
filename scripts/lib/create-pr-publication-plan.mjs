import { validateLifecycleMutation } from "./lifecycle-mutations.mjs";

const CREATE_PR_PUBLICATION_ENTRYPOINT = "scripts/github-mutate.mjs";
const PUSH_MODES = new Set(["force-with-lease", "fast-forward"]);

export function buildCreatePrPublicationPlan(input = {}) {
  if (input.draft === false) {
    throw new Error("create_pr_publication_plan_draft_only");
  }

  const pushMode = input.pushMode === undefined ? "force-with-lease" : input.pushMode;
  if (!PUSH_MODES.has(pushMode)) {
    throw new Error("create_pr_publication_plan_push_mode_invalid");
  }
  // A new remote branch has no fast-forward identity to prove, so an absent
  // expected tip keeps the lease guard instead of becoming an unguarded create.
  if (pushMode === "fast-forward" && input.expectedRemoteTip === "absent") {
    throw new Error("create_pr_publication_plan_fast_forward_requires_remote_tip");
  }

  const requests = [
    {
      schemaVersion: 1,
      action: "push_code",
      mutationMode: "maintainer",
      repo: input.repo,
      remote: input.remote,
      branch: input.branch,
      expectedRemoteTip: input.expectedRemoteTip,
      originalLocalTip: input.originalLocalTip,
      newTip: input.newTip,
      forceWithLease: pushMode !== "fast-forward",
    },
    {
      schemaVersion: 1,
      action: "create_pr",
      mutationMode: "maintainer",
      repo: input.repo,
      base: input.base,
      head: input.branch,
      title: input.title,
      body: input.body,
      idempotencyKey: input.idempotencyKey,
      draft: true,
    },
  ];

  for (const request of requests) validateLifecycleMutation(request);

  return {
    requests,
    execute: {
      entrypoint: CREATE_PR_PUBLICATION_ENTRYPOINT,
      checkpoint: input.checkpoint,
    },
  };
}
