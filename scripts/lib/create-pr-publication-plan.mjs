import { validateLifecycleMutation } from "./lifecycle-mutations.mjs";

const CREATE_PR_PUBLICATION_ENTRYPOINT = "scripts/github-mutate.mjs";

export function buildCreatePrPublicationPlan(input = {}) {
  if (input.draft === false) {
    throw new Error("create_pr_publication_plan_draft_only");
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
      forceWithLease: true,
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
