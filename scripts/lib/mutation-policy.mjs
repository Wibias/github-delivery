export const MUTATION_MODES = [
  "read-only",
  "review",
  "maintainer",
  "autonomous",
];

const ACTIONS = [
  "read_evidence",
  "draft_text",
  "post_review",
  "approve_pr",
  "dismiss_review",
  "post_comment",
  "post_issue_comment",
  "edit_own_comment",
  "reply_bot_thread",
  "reply_human_thread",
  "push_code",
  "record_rewrite_baseline",
  "create_pr",
  "update_pr_body",
  "create_issue",
  "assign_issue",
  "resolve_thread",
  "resolve_bot_thread",
  "change_draft_state",
  "request_reviewers",
  "close_linked_issue",
  "close_pr",
  "merge_pr",
  "retarget_pr",
  "delete_head_branch",
  "create_follow_up_issue",
  "post_resolution_record",
];

const BASE = Object.fromEntries(
  ACTIONS.map((action) => [
    action,
    {
      allowed: false,
      requiresExplicitInstruction: false,
      requiresExactTextConfirmation: false,
    },
  ]),
);

function allow(profile, actions, options = {}) {
  for (const action of actions) {
    profile[action] = {
      allowed: true,
      requiresExplicitInstruction: options.explicit === true,
      requiresExactTextConfirmation: options.exactText === true,
    };
  }
}

function buildProfile(mode) {
  const profile = structuredClone(BASE);
  allow(profile, ["read_evidence", "draft_text"]);
  if (["review", "maintainer", "autonomous"].includes(mode)) {
    allow(profile, [
      "post_review",
      "dismiss_review",
      "post_comment",
      "post_issue_comment",
      "edit_own_comment",
      "reply_bot_thread",
      "resolve_bot_thread",
    ]);
    allow(profile, ["approve_pr"], { explicit: true });
    allow(profile, ["reply_human_thread"], { exactText: true });
  }
  if (["maintainer", "autonomous"].includes(mode)) {
    allow(profile, ["push_code", "record_rewrite_baseline", "post_resolution_record"]);
  }
  if (mode === "maintainer") {
    allow(
      profile,
      [
        "create_pr",
        "update_pr_body",
        "create_issue",
        "assign_issue",
        "resolve_thread",
        "change_draft_state",
        "request_reviewers",
        "close_linked_issue",
        "close_pr",
        "merge_pr",
        "retarget_pr",
        "delete_head_branch",
        "create_follow_up_issue",
      ],
      { explicit: true },
    );
  }
  if (mode === "autonomous") {
    allow(profile, [
      "create_pr",
      "update_pr_body",
      "create_issue",
      "assign_issue",
      "resolve_thread",
      "change_draft_state",
      "request_reviewers",
      "close_linked_issue",
      "retarget_pr",
      "create_follow_up_issue",
    ]);
    allow(profile, ["close_pr", "merge_pr", "delete_head_branch"], { explicit: true });
  }
  return profile;
}

export function normalizeMutationMode(value = "read-only") {
  const mode = String(value || "read-only").toLowerCase();
  if (!MUTATION_MODES.includes(mode)) {
    throw new Error(
      `Unknown mutation mode: ${value}. Expected one of ${MUTATION_MODES.join(", ")}`,
    );
  }
  return mode;
}

export function mutationProfile(mode = "read-only") {
  const normalized = normalizeMutationMode(mode);
  const actions = buildProfile(normalized);
  return {
    mode: normalized,
    actions,
    allowedActions: Object.entries(actions)
      .filter(([, rule]) => rule.allowed)
      .map(([action]) => action),
  };
}

export function mutationRequiresIndependentIntent(request = {}) {
  const action = String(request?.action || "");
  if (!action) return false;
  let mode;
  try {
    mode = normalizeMutationMode(request.mutationMode);
  } catch {
    return false;
  }
  const rule = mutationProfile(mode).actions[action];
  return Boolean(
    rule?.requiresExplicitInstruction || rule?.requiresExactTextConfirmation,
  );
}

export function authorizeMutation({
  mode = "read-only",
  action,
  explicitInstruction = false,
  exactTextConfirmed = false,
} = {}) {
  const profile = mutationProfile(mode);
  const rule = profile.actions[action];
  if (!rule) {
    return {
      allowed: false,
      mode: profile.mode,
      action,
      reason: "unknown_action",
      rule: null,
    };
  }
  if (!rule.allowed) {
    return {
      allowed: false,
      mode: profile.mode,
      action,
      reason: "mode_denied",
      rule,
    };
  }
  if (rule.requiresExplicitInstruction && !explicitInstruction) {
    return {
      allowed: false,
      mode: profile.mode,
      action,
      reason: "explicit_instruction_required",
      rule,
    };
  }
  if (rule.requiresExactTextConfirmation && !exactTextConfirmed) {
    return {
      allowed: false,
      mode: profile.mode,
      action,
      reason: "exact_text_confirmation_required",
      rule,
    };
  }
  return {
    allowed: true,
    mode: profile.mode,
    action,
    reason: null,
    rule,
  };
}

export function extractMutationModeArgs(argv = []) {
  const remaining = [];
  let mode = "read-only";
  let explicitInstruction = false;
  let exactTextConfirmed = false;
  let seenMode = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--mutation-mode") {
      if (seenMode) throw new Error("--mutation-mode may only be provided once");
      const next = argv[++index];
      if (!next || next.startsWith("--")) {
        throw new Error("--mutation-mode requires a value");
      }
      mode = normalizeMutationMode(next);
      seenMode = true;
    } else if (value === "--explicit") {
      explicitInstruction = true;
    } else if (value === "--exact-text-confirmed") {
      exactTextConfirmed = true;
    } else {
      remaining.push(value);
    }
  }
  return {
    argv: remaining,
    mode: normalizeMutationMode(mode),
    explicitInstruction,
    exactTextConfirmed,
  };
}
