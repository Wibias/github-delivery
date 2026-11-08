import { validateLifecycleMutation } from "./lifecycle-mutations.mjs";

const CREATE_PR_PUBLICATION_ENTRYPOINT = "scripts/github-mutate.mjs";
const PUSH_MODES = new Set(["force-with-lease", "fast-forward"]);
const PUBLICATION_MODES = new Set(["push", "already-published"]);

function exactSha(value, name) {
  const text = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40,64}$/.test(text)) throw new Error(`${name}_invalid`);
  return text;
}

function requiredText(value, name) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${name}_required`);
  return text;
}

export function buildCreatePrPublicationPlan(input = {}) {
  const publicationMode = input.publicationMode === undefined
    ? "push"
    : String(input.publicationMode);
  if (!PUBLICATION_MODES.has(publicationMode)) {
    throw new Error("create_pr_publication_plan_mode_invalid");
  }
  if (input.draft === false) {
    throw new Error("create_pr_publication_plan_draft_only");
  }

  if (publicationMode === "already-published") {
    const repo = requiredText(input.repo, "repo");
    const remote = requiredText(input.remote, "remote");
    const branch = requiredText(input.branch, "branch");
    const base = requiredText(input.base, "base");
    const sha = exactSha(input.publishedSha ?? input.newTip, "published_sha");
    const request = {
      schemaVersion: 1,
      action: "create_pr",
      mutationMode: "maintainer",
      repo,
      base,
      head: branch,
      title: input.title,
      body: input.body,
      idempotencyKey: input.idempotencyKey,
      draft: true,
      publishedHead: { repo, remote, branch, base, sha },
    };
    validateLifecycleMutation(request);
    return {
      publicationMode,
      requests: [request],
      execute: {
        entrypoint: CREATE_PR_PUBLICATION_ENTRYPOINT,
        checkpoint: input.checkpoint,
      },
    };
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
    publicationMode: "push",
    requests,
    execute: {
      entrypoint: CREATE_PR_PUBLICATION_ENTRYPOINT,
      checkpoint: input.checkpoint,
    },
  };
}
