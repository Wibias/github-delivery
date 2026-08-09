import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGraph,
  connectedFromHead,
  listAllOpenPullRequests,
  normalizePullPages,
} from "../../scripts/inspect-stack.mjs";

function pull(
  number,
  baseRefName = "main",
  {
    headRefName = `branch-${number}`,
    headRepo = "acme/widgets",
    baseRepo = "acme/widgets",
  } = {},
) {
  return {
    number,
    title: `PR ${number}`,
    html_url: `https://github.com/acme/widgets/pull/${number}`,
    draft: false,
    head: {
      ref: headRefName,
      sha: `sha-${number}`,
      repo: { full_name: headRepo },
    },
    base: {
      ref: baseRefName,
      repo: { full_name: baseRepo },
    },
  };
}

test("normalizes every page instead of silently stopping at 100 open PRs", () => {
  const first = Array.from({ length: 100 }, (_, index) => pull(index + 1));
  const second = [pull(101, "branch-100")];
  const prs = normalizePullPages([first, second]);
  assert.equal(prs.length, 101);
  assert.equal(prs[100].number, 101);
  assert.equal(prs[100].baseRefName, "branch-100");
  assert.equal(prs[100].headRepoFullName, "acme/widgets");
  assert.equal(prs[100].baseRepoFullName, "acme/widgets");

  const { byHead, children } = buildGraph(prs);
  const stack = connectedFromHead("branch-101", byHead, children, "acme/widgets");
  assert.deepEqual(stack.map((pr) => pr.number), [100, 101]);
});

test("listAllOpenPullRequests requires gh pagination and slurps all pages", () => {
  let call = null;
  const prs = listAllOpenPullRequests("acme/widgets", (command, args) => {
    call = [command, ...args];
    return JSON.stringify([
      [pull(1)],
      [pull(2, "branch-1")],
    ]);
  });
  assert.equal(prs.length, 2);
  assert.deepEqual(call, [
    "gh",
    "api",
    "repos/acme/widgets/pulls?state=open&per_page=100",
    "--paginate",
    "--slurp",
  ]);
});

test("incomplete PR rows fail closed instead of producing partial topology", () => {
  assert.throws(
    () =>
      normalizePullPages([
        [
          {
            number: 101,
            head: { ref: "child", repo: { full_name: "acme/widgets" } },
            base: { repo: { full_name: "acme/widgets" } },
          },
        ],
      ]),
    /stack_pr_row_incomplete/,
  );
});

test("missing repository identity fails closed", () => {
  assert.throws(
    () =>
      normalizePullPages([
        [
          {
            number: 101,
            head: { ref: "child", sha: "abc", repo: null },
            base: { ref: "main", repo: { full_name: "acme/widgets" } },
          },
        ],
      ]),
    /stack_pr_row_incomplete/,
  );
});

test("duplicate open heads are rejected only when repository and branch are both identical", () => {
  assert.throws(
    () =>
      buildGraph(
        normalizePullPages([
          [
            pull(1, "main", { headRefName: "same" }),
            pull(2, "release", { headRefName: "same" }),
          ],
        ]),
      ),
    /stack_duplicate_open_head:acme\/widgets:same/,
  );
});

test("two forks may use the same head branch without ambiguous topology", () => {
  const prs = normalizePullPages([
    [
      pull(1, "main", { headRefName: "feature", headRepo: "fork-a/widgets" }),
      pull(2, "main", { headRefName: "feature", headRepo: "fork-b/widgets" }),
    ],
  ]);
  const { byHead } = buildGraph(prs);
  assert.equal(byHead.size, 2);
});

test("a fork branch named like an upstream parent cannot create a false stack edge", () => {
  const prs = normalizePullPages([
    [
      pull(1, "dev", {
        headRefName: "feature",
        headRepo: "acme/widgets",
        baseRepo: "acme/widgets",
      }),
      pull(2, "main", {
        headRefName: "dev",
        headRepo: "fork-owner/widgets",
        baseRepo: "acme/widgets",
      }),
    ],
  ]);
  const { byHead, children } = buildGraph(prs);
  const upstream = connectedFromHead("feature", byHead, children, "acme/widgets");
  const fork = connectedFromHead("dev", byHead, children, "fork-owner/widgets");
  assert.deepEqual(upstream.map((pr) => pr.number), [1]);
  assert.deepEqual(fork.map((pr) => pr.number), [2]);
});

test("a same-repository base/head match still creates the expected stack edge", () => {
  const prs = normalizePullPages([
    [
      pull(1, "main", { headRefName: "parent" }),
      pull(2, "parent", { headRefName: "child" }),
    ],
  ]);
  const { byHead, children } = buildGraph(prs);
  const stack = connectedFromHead("child", byHead, children, "acme/widgets");
  assert.deepEqual(stack.map((pr) => pr.number), [1, 2]);
});
