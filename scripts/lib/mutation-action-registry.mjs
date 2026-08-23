const MODE_RANK = Object.freeze({
  "read-only": 0,
  review: 1,
  maintainer: 2,
  autonomous: 3,
});

const DEFINITIONS = [
  { action: "read_evidence", enabled: true, mutation: false, route: "local", minimumMode: "read-only", authorityScopeKind: null },
  { action: "draft_text", enabled: true, mutation: false, route: "local", minimumMode: "read-only", authorityScopeKind: null },
  { action: "post_review", enabled: true, mutation: true, route: "legacy", minimumMode: "review", prBound: true, social: true, highAssurance: true, remoteIdempotentCreate: true, authorityScopeKind: "pr_body_social" },
  { action: "post_comment", enabled: true, mutation: true, route: "legacy", minimumMode: "review", prBound: true, social: true, highAssurance: true, remoteIdempotentCreate: true, authorityScopeKind: "pr_body_social" },
  { action: "post_issue_comment", enabled: true, mutation: true, route: "legacy", minimumMode: "review", social: true, highAssurance: true, remoteIdempotentCreate: true, authorityScopeKind: "issue_comment" },
  { action: "edit_own_comment", enabled: true, mutation: true, route: "legacy", minimumMode: "review", prBound: true, social: true, highAssurance: true, authorityScopeKind: "edit_own_comment" },
  { action: "reply_bot_thread", enabled: true, mutation: true, route: "legacy", minimumMode: "review", prBound: true, social: true, highAssurance: true, remoteIdempotentCreate: true, authorityScopeKind: "reply_thread" },
  { action: "reply_human_thread", enabled: true, mutation: true, route: "legacy", minimumMode: "review", prBound: true, social: true, remoteIdempotentCreate: true, humanReply: true, highAssurance: true, authorityScopeKind: "reply_thread" },
  { action: "push_code", enabled: true, mutation: true, route: "lifecycle", minimumMode: "maintainer", highAssurance: true, authorityScopeKind: "push_code" },
  { action: "record_rewrite_baseline", enabled: true, mutation: true, route: "lifecycle", minimumMode: "maintainer", highAssurance: false, authorityScopeKind: "record_rewrite_baseline" },
  { action: "create_pr", enabled: true, mutation: true, route: "lifecycle", minimumMode: "maintainer", highAssurance: true, remoteIdempotentCreate: true, authorityScopeKind: "create_pr" },
  { action: "update_pr_body", enabled: true, mutation: true, route: "lifecycle", minimumMode: "maintainer", prBound: true, highAssurance: true, authorityScopeKind: "update_pr_body" },
  { action: "create_issue", enabled: true, mutation: true, route: "lifecycle", minimumMode: "maintainer", highAssurance: true, remoteIdempotentCreate: true, issueCreationKind: "direct", authorityScopeKind: "create_issue" },
  { action: "assign_issue", enabled: true, mutation: true, route: "lifecycle", minimumMode: "maintainer", highAssurance: true, authorityScopeKind: "assign_issue" },
  { action: "resolve_thread", enabled: true, mutation: true, route: "legacy", minimumMode: "maintainer", prBound: true, reviewThread: true, highAssurance: true, authorityScopeKind: "resolve_thread" },
  { action: "resolve_bot_thread", enabled: true, mutation: true, route: "legacy", minimumMode: "review", prBound: true, reviewThread: true, highAssurance: true, authorityScopeKind: "resolve_thread" },
  { action: "change_draft_state", enabled: true, mutation: true, route: "legacy", minimumMode: "maintainer", prBound: true, highAssurance: true, authorityScopeKind: "change_draft_state" },
  { action: "request_reviewers", enabled: true, mutation: true, route: "legacy", minimumMode: "maintainer", prBound: true, highAssurance: true, authorityScopeKind: "request_reviewers" },
  { action: "close_linked_issue", enabled: true, mutation: true, route: "legacy", minimumMode: "maintainer", destructive: true, highAssurance: true, authorityScopeKind: "close_linked_issue" },
  { action: "close_pr", enabled: true, mutation: true, route: "legacy", minimumMode: "maintainer", prBound: true, destructive: true, highAssurance: true, authorityScopeKind: "close_pr" },
  { action: "merge_pr", enabled: true, mutation: true, route: "legacy", minimumMode: "maintainer", prBound: true, destructive: true, highAssurance: true, authorityScopeKind: "merge_pr" },
  { action: "retarget_pr", enabled: true, mutation: true, route: "legacy", minimumMode: "maintainer", prBound: true, highAssurance: true, authorityScopeKind: "retarget_pr" },
  { action: "delete_head_branch", enabled: true, mutation: true, route: "legacy", minimumMode: "maintainer", cleanup: true, destructive: true, highAssurance: true, authorityScopeKind: "delete_head_branch" },
  { action: "create_follow_up_issue", enabled: true, mutation: true, route: "legacy", minimumMode: "maintainer", social: true, highAssurance: true, remoteIdempotentCreate: true, issueCreationKind: "follow_up", authorityScopeKind: "create_issue" },
  { action: "post_resolution_record", enabled: true, mutation: true, route: "legacy", minimumMode: "maintainer", prBound: true, social: true, highAssurance: true, remoteIdempotentCreate: true, authorityScopeKind: "pr_body_social" },
  {
    action: "supersede_pr",
    enabled: false,
    mutation: true,
    route: "legacy",
    minimumMode: "maintainer",
    prBound: true,
    social: true,
    destructive: true,
    authorityScopeKind: "supersede_pr",
    legacyReason: "Composite supersede mutation is intentionally policy-disabled; use atomic broker actions instead.",
  },
];

const REGISTRY = new Map(
  DEFINITIONS.map((definition) => [
    definition.action,
    Object.freeze({
      prBound: false,
      social: false,
      remoteIdempotentCreate: false,
      reviewThread: false,
      cleanup: false,
      destructive: false,
      highAssurance: false,
      humanReply: false,
      issueCreationKind: null,
      ...definition,
    }),
  ]),
);

export const MUTATION_ACTION_REGISTRY = Object.freeze(
  Object.fromEntries([...REGISTRY.entries()]),
);

export function actionDefinition(action) {
  return REGISTRY.get(String(action || "")) || null;
}

export function enabledActionNames() {
  return [...REGISTRY.values()]
    .filter((definition) => definition.enabled !== false)
    .map((definition) => definition.action);
}

export function mutationActionNames({ enabledOnly = true } = {}) {
  return [...REGISTRY.values()]
    .filter(
      (definition) =>
        definition.mutation === true &&
        (!enabledOnly || definition.enabled !== false),
    )
    .map((definition) => definition.action);
}

export function actionNamesWhere(
  property,
  expected = true,
  { enabledOnly = true } = {},
) {
  return [...REGISTRY.values()]
    .filter(
      (definition) =>
        (!enabledOnly || definition.enabled !== false) &&
        definition[property] === expected,
    )
    .map((definition) => definition.action);
}

export function actionAllowedInMode(action, mode) {
  const definition = actionDefinition(action);
  if (!definition || definition.enabled === false) return false;
  const current = MODE_RANK[String(mode || "read-only").toLowerCase()];
  const minimum = MODE_RANK[definition.minimumMode];
  if (current === undefined || minimum === undefined) return false;
  return current >= minimum;
}

export function validateMutationActionRegistry() {
  const errors = [];
  const seen = new Set();
  for (const definition of REGISTRY.values()) {
    if (!definition.action) errors.push("action_missing");
    if (seen.has(definition.action)) errors.push(`duplicate:${definition.action}`);
    seen.add(definition.action);
    if (!(definition.minimumMode in MODE_RANK)) {
      errors.push(`minimum_mode_invalid:${definition.action}`);
    }
    if (!["local", "lifecycle", "legacy"].includes(definition.route)) {
      errors.push(`route_invalid:${definition.action}`);
    }
    if (definition.mutation && !definition.authorityScopeKind) {
      errors.push(`authority_scope_missing:${definition.action}`);
    }
    if (!definition.mutation && definition.highAssurance) {
      errors.push(`non_mutation_high_assurance:${definition.action}`);
    }
    if (definition.remoteIdempotentCreate && !definition.mutation) {
      errors.push(`non_mutation_idempotent_create:${definition.action}`);
    }
    if (definition.reviewThread && !definition.prBound) {
      errors.push(`review_thread_not_pr_bound:${definition.action}`);
    }
    if (
      definition.issueCreationKind !== null &&
      !["direct", "follow_up"].includes(definition.issueCreationKind)
    ) {
      errors.push(`issue_creation_kind_invalid:${definition.action}`);
    }
  }
  if (REGISTRY.get("create_issue")?.issueCreationKind !== "direct") {
    errors.push("create_issue_kind_invalid");
  }
  if (REGISTRY.get("create_follow_up_issue")?.issueCreationKind !== "follow_up") {
    errors.push("create_follow_up_issue_kind_invalid");
  }
  return { valid: errors.length === 0, errors };
}
