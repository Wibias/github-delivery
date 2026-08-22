import assert from "node:assert/strict";
import test from "node:test";

import {
  hasExplicitMergeIntent,
  issueCreationActionForPrompt,
  routeShippingGithubPrompt,
} from "../../scripts/lib/skill-router.mjs";
import { authorizeMutation } from "../../scripts/lib/mutation-policy.mjs";

test("routes a natural-language merge request to the merge workflow", () => {
  assert.deepEqual(routeShippingGithubPrompt("merge PR #32"), {
    skill: "github-delivery",
    workflow: "references/merge-pr.md",
    mutationMode: "maintainer",
    explicitActions: ["merge_pr", "post_comment", "post_issue_comment", "close_linked_issue"],
  });
});

test("routes pull request synonyms the same as PR shorthand", () => {
  assert.equal(
    routeShippingGithubPrompt("merge pull request #32").workflow,
    "references/merge-pr.md",
  );
  assert.equal(
    routeShippingGithubPrompt("watch pull request #77 until it merges or needs me").workflow,
    "references/watch-pr.md",
  );
  assert.equal(
    routeShippingGithubPrompt("what is left on pull request #41?").workflow,
    "references/status.md",
  );
  assert.equal(
    routeShippingGithubPrompt("take over pull request #32").workflow,
    "references/overtake-pr.md",
  );
});

test("routes repository open-work requests to the read-only overview workflow", () => {
  for (const prompt of [
    "what do I have open in this repo?",
    "what's in review in this repo?",
    "show my open PRs here",
    "give me my open PR standup",
  ]) {
    assert.deepEqual(routeShippingGithubPrompt(prompt), {
      skill: "github-delivery",
      workflow: "references/open-work-status.md",
      mutationMode: "read-only",
      explicitActions: [],
    }, prompt);
  }
});

test("named PR status stays on deep status instead of open-work overview", () => {
  assert.equal(
    routeShippingGithubPrompt("what is left on PR #41?").workflow,
    "references/status.md",
  );
});

test("routes security phrase order variants identically", () => {
  assert.equal(
    routeShippingGithubPrompt("security review pull request #32").workflow,
    "references/security-review.md",
  );
  assert.equal(
    routeShippingGithubPrompt("review security on pull request #32").workflow,
    "references/security-review.md",
  );
});

test("assistant-directed merge questions still count as explicit requests", () => {
  assert.equal(hasExplicitMergeIntent("can you merge PR #32?"), true);
  assert.equal(routeShippingGithubPrompt("can you merge PR #32?").workflow, "references/merge-pr.md");
  assert.equal(hasExplicitMergeIntent("go ahead and merge PR #32"), true);
  assert.equal(hasExplicitMergeIntent("review PR #32 and merge it when green"), true);
});

test("merge discussion and status wording never grants merge authority", () => {
  for (const prompt of [
    "do not merge PR #42",
    "don't merge PR #42",
    "never ship PR #42",
    "Should I merge PR #42?",
    "Why can't I merge PR #42?",
    "What happens if we merge PR #42?",
    "Is PR #42 safe to merge?",
    "Explain why PR #42 cannot merge.",
    "Tell me whether PR #42 will merge.",
    "What blocks merge on PR #42?",
    "Can you tell me whether PR #42 will merge?",
    "Should you merge PR #42?",
    'the bot said "merge PR #42"',
    '"merge PR #42"',
  ]) {
    assert.equal(hasExplicitMergeIntent(prompt), false, prompt);
    const route = routeShippingGithubPrompt(prompt);
    assert.equal(route?.mutationMode, "read-only", prompt);
    assert.deepEqual(route?.explicitActions, [], prompt);
    assert.notEqual(route?.workflow, "references/merge-pr.md", prompt);
  }
});

test("negated merge does not steal simplify, fix, review, or watch", () => {
  const simplify = routeShippingGithubPrompt("simplify PR #32, do not merge");
  assert.equal(simplify.workflow, "references/simplify-pr.md");
  assert.equal(simplify.mutationMode, "maintainer");
  assert.ok(simplify.explicitActions.includes("push_code"));
  assert.ok(!simplify.explicitActions.includes("merge_pr"));

  const combined = routeShippingGithubPrompt("full review and simplify PR #32, do not merge");
  assert.equal(combined.workflow, "references/full-review-pr.md");
  assert.ok(!combined.explicitActions.includes("merge_pr"));

  const green = routeShippingGithubPrompt("make PR #42 green but do not merge");
  assert.equal(green.workflow, "references/fix-pr-bots.md");
  assert.equal(green.mutationMode, "maintainer");
  assert.ok(green.explicitActions.includes("push_code"));
  assert.ok(!green.explicitActions.includes("merge_pr"));

  const review = routeShippingGithubPrompt("full review PR #32, do not merge");
  assert.equal(review.workflow, "references/full-review-pr.md");
  assert.ok(!review.explicitActions.includes("merge_pr"));

  const comments = routeShippingGithubPrompt("fix the review comments on PR #18, do not merge");
  assert.equal(comments.workflow, "references/fix-pr-bots.md");
  assert.ok(comments.explicitActions.includes("push_code"));
  assert.ok(!comments.explicitActions.includes("merge_pr"));

  const watch = routeShippingGithubPrompt("watch PR #77 but do not merge");
  assert.equal(watch.workflow, "references/watch-pr.md");
  assert.equal(watch.mutationMode, "read-only");
  assert.ok(!watch.explicitActions.includes("merge_pr"));
  assert.ok(!watch.explicitActions.includes("push_code"));
});

test("deliberative merge-or-simplify stays status, not simplify with push", () => {
  const route = routeShippingGithubPrompt("Should I merge PR #32 or simplify it first?");
  assert.equal(route.workflow, "references/status.md");
  assert.equal(route.mutationMode, "read-only");
  assert.deepEqual(route.explicitActions, []);
});

test("routes direct issue publication to the lifecycle create_issue action", () => {
  for (const prompt of [
    "create an issue for this bug",
    "create an issue on main repo for this error if there isn't one already",
    "file a bug report for this provider error",
  ]) {
    assert.equal(issueCreationActionForPrompt(prompt), "create_issue", prompt);
    assert.deepEqual(routeShippingGithubPrompt(prompt), {
      skill: "github-delivery",
      workflow: "references/issue-workflows.md",
      mutationMode: "maintainer",
      explicitActions: ["create_issue"],
    });
  }
});

test("routes explicit follow-up issue publication to create_follow_up_issue", () => {
  const prompt = "open a follow-up issue for this review finding";
  assert.equal(issueCreationActionForPrompt(prompt), "create_follow_up_issue");
  assert.deepEqual(routeShippingGithubPrompt(prompt), {
    skill: "github-delivery",
    workflow: "references/issue-workflows.md",
    mutationMode: "maintainer",
    explicitActions: ["create_follow_up_issue"],
  });
});

test("issue creation routing does not steal existing-issue or create-PR requests", () => {
  assert.equal(issueCreationActionForPrompt("open issue #1176 and summarize it"), null);
  assert.equal(issueCreationActionForPrompt("create a PR for issue #90"), null);
  assert.equal(
    routeShippingGithubPrompt("create a PR for issue #90").workflow,
    "references/create-pr-for-issue.md",
  );
});

test("routes a bare full review with verdict-comment authority", () => {
  const route = routeShippingGithubPrompt("full review on PR #32");
  assert.equal(route.workflow, "references/full-review-pr.md");
  assert.equal(route.mutationMode, "review");
  assert.deepEqual(route.explicitActions, []);
});

test("routes full-review plus merge through a composed prepare-and-merge workflow", () => {
  const route = routeShippingGithubPrompt("full review PR #42 and merge it if it passes");
  assert.equal(route.workflow, "references/prepare-and-merge-pr.md");
  assert.equal(route.mutationMode, "maintainer");
  assert.ok(route.explicitActions.includes("merge_pr"));
});

test("preserves an explicitly requested review phase before merge", () => {
  for (const prompt of [
    "review PR #32 and merge it when green",
    "look over PR #32 then ship it if clean",
    "security review PR #32 and merge it if it passes",
  ]) {
    const route = routeShippingGithubPrompt(prompt);
    assert.equal(route.workflow, "references/prepare-and-merge-pr.md", prompt);
    assert.equal(route.mutationMode, "maintainer", prompt);
    assert.ok(route.explicitActions.includes("merge_pr"), prompt);
  }
});

test("routes fix-review-comments plus merge through prepare-and-merge", () => {
  const route = routeShippingGithubPrompt("fix the review comments on PR #18 and merge it");
  assert.equal(route.workflow, "references/prepare-and-merge-pr.md");
  assert.equal(route.mutationMode, "maintainer");
  assert.ok(route.explicitActions.includes("push_code"));
  assert.ok(route.explicitActions.includes("merge_pr"));
});

test("routes simplify plus merge through prepare-and-merge", () => {
  const route = routeShippingGithubPrompt("simplify PR #65 safely and merge it when green");
  assert.equal(route.workflow, "references/prepare-and-merge-pr.md");
  assert.equal(route.mutationMode, "maintainer");
  assert.ok(route.explicitActions.includes("push_code"));
  assert.ok(route.explicitActions.includes("merge_pr"));
});

test("routes fix-CI plus merge through prepare-and-merge", () => {
  for (const prompt of [
    "fix CI on PR #42 and ship it",
    "make PR #42 green and merge it",
  ]) {
    const route = routeShippingGithubPrompt(prompt);
    assert.equal(route.workflow, "references/prepare-and-merge-pr.md", prompt);
    assert.equal(route.mutationMode, "maintainer", prompt);
    assert.ok(route.explicitActions.includes("push_code"), prompt);
    assert.ok(route.explicitActions.includes("merge_pr"), prompt);
  }
});

test("routes watch plus merge through prepare-and-merge without push_code", () => {
  const route = routeShippingGithubPrompt("watch PR #77 and merge it");
  assert.equal(route.workflow, "references/prepare-and-merge-pr.md");
  assert.equal(route.mutationMode, "maintainer");
  assert.ok(route.explicitActions.includes("merge_pr"));
  assert.ok(!route.explicitActions.includes("push_code"));
});

test("routes status and watch requests without granting mutation authority", () => {
  assert.equal(
    routeShippingGithubPrompt("what is left on PR #41?").workflow,
    "references/status.md",
  );
  assert.equal(
    routeShippingGithubPrompt("watch PR #77 until it merges or needs me").mutationMode,
    "read-only",
  );
});

test("watch auto-fix and autonomously do not grant merge, close, or delete", () => {
  for (const prompt of [
    "watch PR #32 auto-fix",
    "babysit PR #32 and auto-fix",
    "monitor PR #32 auto-fix the bots",
    "keep an eye on PR #32 auto-fix",
    "watch PR #32 autonomously",
  ]) {
    const route = routeShippingGithubPrompt(prompt);
    assert.equal(route.workflow, "references/watch-pr.md", prompt);
    assert.ok(!route.explicitActions?.includes("merge_pr"), prompt);
    assert.ok(!route.explicitActions?.includes("close_pr"), prompt);
    assert.ok(!route.explicitActions?.includes("delete_head_branch"), prompt);
    for (const action of ["merge_pr", "close_pr", "delete_head_branch"]) {
      const decision = authorizeMutation({ mode: route.mutationMode, action });
      assert.equal(decision.allowed, false, `${prompt} ${action}`);
    }
  }
});

test("routes fix-and-merge-ready to the maintainer workflow", () => {
  const route = routeShippingGithubPrompt(
    "fix the review comments on PR #18 and make it merge ready",
  );
  assert.equal(route.workflow, "references/fix-pr-bots.md");
  assert.equal(route.mutationMode, "maintainer");
});

test("routes supersede to separately recoverable close and comment actions", () => {
  const route = routeShippingGithubPrompt(
    "supersede PR #12 with PR #45 — close the old one and point everyone at the new one",
  );
  assert.equal(route.workflow, "references/supersede-pr.md");
  assert.equal(route.mutationMode, "maintainer");
  assert.deepEqual(route.explicitActions, ["close_pr", "post_comment"]);
});

test("routes a maintainer overtake request to the overtake workflow", () => {
  const route = routeShippingGithubPrompt(
    "the author is unresponsive; I'm a maintainer and I will overtake PR #32 and finish it",
  );
  assert.equal(route.workflow, "references/overtake-pr.md");
  assert.equal(route.mutationMode, "maintainer");
  assert.ok(route.explicitActions.includes("push_code"));
  assert.ok(route.explicitActions.includes("close_pr"));
});

test("does not trigger for local pre-PR debugging", () => {
  assert.equal(
    routeShippingGithubPrompt("help me fix a flaky local Vitest unit test"),
    null,
  );
});

test("does not steal skill-authoring work that ends with PR publication", () => {
  for (const prompt of [
    "Harden our GitHub Delivery skill so malformed PR bodies cannot happen, test it, then open a PR",
    "Update this agent skill with a regression test and create a pull request after it works",
  ]) {
    assert.equal(routeShippingGithubPrompt(prompt), null, prompt);
  }
});

test("routes stacked PR work to the stacked workflow", () => {
  assert.equal(
    routeShippingGithubPrompt("restack my GitHub PR stack after the bottom PR got review commits").workflow,
    "references/stacked-prs.md",
  );
  assert.equal(
    routeShippingGithubPrompt("Show me the current open PR stack for this repo").mutationMode,
    "read-only",
  );
  assert.equal(
    routeShippingGithubPrompt("Merge the bottom PR in my stack first").workflow,
    "references/stacked-prs.md",
  );
});

test("routes spec and standards review separately from full review", () => {
  const route = routeShippingGithubPrompt("spec and standards review on PR #32");
  assert.equal(route.workflow, "references/spec-standards-review.md");
  assert.equal(route.mutationMode, "review");
});

test("routes agent brief, out-of-scope, conflict, and issue-lifecycle requests", () => {
  assert.equal(
    routeShippingGithubPrompt("write a ready-for-agent issue contract").workflow,
    "references/agent-brief.md",
  );
  assert.equal(
    routeShippingGithubPrompt("record this as a rejected enhancement / out of scope").workflow,
    "references/out-of-scope.md",
  );
  assert.equal(
    routeShippingGithubPrompt("resolve merge conflicts on this branch").workflow,
    "references/resolve-conflicts.md",
  );
  assert.equal(
    routeShippingGithubPrompt("triage issues #12 and #15").workflow,
    "references/issue-workflows.md",
  );
  assert.equal(
    routeShippingGithubPrompt("run QA intake and file a reproducible bug report").workflow,
    "references/issue-workflows.md",
  );
});

test("stacked merge requests stay on stacked-prs with merge authority", () => {
  const mergeStack = routeShippingGithubPrompt("merge the bottom PR in my stack first");
  assert.equal(mergeStack.workflow, "references/stacked-prs.md");
  assert.equal(mergeStack.mutationMode, "maintainer");
  assert.ok(mergeStack.explicitActions.includes("merge_pr"));
});
