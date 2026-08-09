import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGraph,
  connectedFromHead,
  listAllOpenPullRequests,
  normalizePullPages,
} from "../../scripts/inspect-stack.mjs";

function pull(number, baseRefName = "main") {
  return {
    number,
    title: `PR ${number}`,
    html_url: `https://github.com/acme/widgets/pull/${number}`,
    draft: false,
    head: { ref: `branch-${number}`, sha: `sha-${number}` },
    base: { ref: baseRefName },
  };
}

test("normalizes every page instead of silently stopping at 100 open PRs", () => {
  const first = Array.from({ length: 100 }, (_, index) => pull(index + 1));
  const second = [pull(101, "branch-100")];
  const prs = normalizePullPages([first, second]);
  assert.equal(prs.length, 101);
  assert.equal(prs[100].number, 101);
  assert.equal(prs[100].baseRefName, "branch-100");

  const { byHead, children } = buildGraph(prs);
  const stack = connectedFromHead("branch-101", byHead, children);
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
    () => normalizePullPages([[{ number: 101, head: { ref: "child" }, base: {} }]]),
    /stack_pr_row_incomplete/,
  );
});

test("duplicate open head branches are rejected as ambiguous topology", () => {
  assert.throws(
    () =>
      buildGraph([
        { number: 1, headRefName: "same", baseRefName: "main" },
        { number: 2, headRefName: "same", baseRefName: "main" },
      ]),
    /stack_duplicate_open_head/,
  );
});
