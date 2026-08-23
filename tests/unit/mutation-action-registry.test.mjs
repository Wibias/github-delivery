import assert from "node:assert/strict";
import test from "node:test";

import {
  actionAllowedInMode,
  actionDefinition,
  actionNamesWhere,
  enabledActionNames,
  mutationActionNames,
  validateMutationActionRegistry,
} from "../../scripts/lib/mutation-action-registry.mjs";
import {
  MUTATION_MODES,
  mutationProfile,
} from "../../scripts/lib/mutation-policy.mjs";
import { isLifecycleMutationAction } from "../../scripts/lib/github-lifecycle-mutation-broker.mjs";
import { mutationRequiresTrustedAuthority } from "../../scripts/lib/mutation-execution-context.mjs";
import { authorityScopeForRequest } from "../../scripts/lib/authority-scope.mjs";

function fixtureFor(action) {
  const common = {
    schemaVersion: 1,
    action,
    mutationMode: "maintainer",
    explicitInstruction: true,
    repo: "acme/widgets",
    pr: 42,
    expectedHead: "a".repeat(40),
    idempotencyKey: `fixture-${action}`,
    body: "body",
    title: "title",
    issue: 7,
    assignee: "alice",
    commentId: 8,
    threadId: "PRRT_fixture",
    reviewers: ["alice"],
    remote: "origin",
    branch: "feature/safe",
    expectedRemoteTip: "b".repeat(40),
    originalLocalTip: "e".repeat(40),
    newTip: "c".repeat(40),
    forceWithLease: true,
    base: "main",
    head: "feature/safe",
    draft: true,
    expectedBase: "main",
    expectedBaseOid: "d".repeat(40),
    newBase: "release",
    mergeMethod: "merge",
    ready: true,
    targetRepo: "acme/widgets",
    headRefName: "feature/safe",
  };
  return common;
}

test("mutation action registry is internally complete", () => {
  assert.deepEqual(validateMutationActionRegistry(), { valid: true, errors: [] });
  assert.ok(enabledActionNames().includes("merge_pr"));
  assert.ok(mutationActionNames().includes("post_comment"));
  assert.equal(actionDefinition("supersede_pr").enabled, false);
});

test("direct issue creation and follow-up issue creation remain distinct actions", () => {
  const direct = actionDefinition("create_issue");
  const followUp = actionDefinition("create_follow_up_issue");

  assert.equal(direct.issueCreationKind, "direct");
  assert.equal(direct.route, "lifecycle");
  assert.equal(direct.minimumMode, "maintainer");

  assert.equal(followUp.issueCreationKind, "follow_up");
  assert.equal(followUp.route, "legacy");
  assert.equal(followUp.minimumMode, "maintainer");
});

test("registry minimum modes match executable mutation policy", () => {
  for (const mode of MUTATION_MODES) {
    const profile = mutationProfile(mode);
    for (const action of enabledActionNames()) {
      assert.equal(
        actionAllowedInMode(action, mode),
        profile.actions[action]?.allowed === true,
        `${action} in ${mode}`,
      );
    }
  }
});

test("mutation policy exposes exactly the enabled registry actions", () => {
  const profile = mutationProfile("autonomous");
  assert.deepEqual(Object.keys(profile.actions).sort(), enabledActionNames().sort());
});

test("lifecycle router classification comes from the registry", () => {
  const expected = new Set(actionNamesWhere("route", "lifecycle", { enabledOnly: false }));
  for (const action of mutationActionNames({ enabledOnly: false })) {
    assert.equal(isLifecycleMutationAction(action), expected.has(action), action);
  }
});

test("high-assurance execution classification comes from the registry", () => {
  const highAssurance = new Set(actionNamesWhere("highAssurance", true, { enabledOnly: false }));
  for (const action of mutationActionNames({ enabledOnly: false })) {
    assert.equal(
      mutationRequiresTrustedAuthority({ mutationMode: "maintainer", action }),
      highAssurance.has(action),
      action,
    );
  }
});

test("every enabled mutation action has executable authority scope semantics", () => {
  for (const action of mutationActionNames()) {
    const definition = actionDefinition(action);
    assert.ok(definition.authorityScopeKind, `${action} missing authorityScopeKind`);
    assert.doesNotThrow(() => authorityScopeForRequest(fixtureFor(action)), action);
  }
});

test("disabled legacy composite action remains policy-inaccessible", () => {
  const maintainer = mutationProfile("maintainer");
  assert.equal(maintainer.actions.supersede_pr, undefined);
  assert.equal(actionDefinition("supersede_pr").enabled, false);
});
