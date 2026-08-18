import assert from "node:assert/strict";
import test from "node:test";

import { buildOpenWorkStatus, normalizeOpenPullPages } from "../../scripts/open-work-status.mjs";

function apiRow(overrides = {}) {
  return {
    number: 12,
    title: "ENG-12 Improve delivery",
    html_url: "https://github.com/Wibias/github-delivery/pull/12",
    user: { login: "Wibias" },
    draft: false,
    updated_at: "2026-08-18T00:00:00Z",
    mergeable_state: "clean",
    head: {
      ref: "feature/ENG-12-delivery",
      sha: "a".repeat(40),
      repo: { full_name: "Wibias/github-delivery" },
    },
    base: {
      ref: "main",
      repo: { full_name: "Wibias/github-delivery" },
    },
    body: "Body",
    ...overrides,
  };
}

test("normalizes every page and preserves repository identity", () => {
  const rows = normalizeOpenPullPages([
    [apiRow({ number: 11 })],
    [apiRow({ number: 12 })],
  ], "Wibias/github-delivery");

  assert.deepEqual(rows.map((row) => row.number), [11, 12]);
  assert.ok(rows.every((row) => row.targetRepoFullName === "Wibias/github-delivery"));
});

test("fails closed on malformed rows instead of silently dropping them", () => {
  assert.throws(
    () => normalizeOpenPullPages([[apiRow(), { number: 99 }]], "Wibias/github-delivery"),
    /open_work_pr_row_incomplete/,
  );
});

test("fails closed when a returned row targets another repository", () => {
  assert.throws(
    () => normalizeOpenPullPages([[apiRow({ base: { ref: "main", repo: { full_name: "Other/repo" } } })]], "Wibias/github-delivery"),
    /open_work_repo_mismatch/,
  );
});

test("filters to the authenticated author and sorts descending by PR number", () => {
  const rows = normalizeOpenPullPages([[
    apiRow({ number: 9 }),
    apiRow({ number: 14 }),
    apiRow({ number: 13, user: { login: "someone-else" } }),
  ]], "Wibias/github-delivery");

  const result = buildOpenWorkStatus({
    repository: "Wibias/github-delivery",
    authenticatedLogin: "wibias",
    rows,
  });

  assert.equal(result.complete, true);
  assert.deepEqual(result.pullRequests.map((row) => row.number), [14, 9]);
});

test("returns a trustworthy empty result when the user has no open PRs", () => {
  const result = buildOpenWorkStatus({
    repository: "Wibias/github-delivery",
    authenticatedLogin: "Wibias",
    rows: [],
  });

  assert.deepEqual(result.pullRequests, []);
  assert.equal(result.complete, true);
});

test("carries a ranked work-item reference without inventing tracker state", () => {
  const rows = normalizeOpenPullPages([[
    apiRow({ number: 20, title: "No key in title", body: "No key in body", head: { ref: "feature/OPS-44-retry", sha: "b".repeat(40), repo: { full_name: "Wibias/github-delivery" } } }),
  ]], "Wibias/github-delivery");

  const result = buildOpenWorkStatus({
    repository: "Wibias/github-delivery",
    authenticatedLogin: "Wibias",
    rows,
  });

  assert.equal(result.pullRequests[0].workItem.state, "resolved");
  assert.equal(result.pullRequests[0].workItem.reference.key, "OPS-44");
  assert.equal(result.pullRequests[0].workItem.reference.url, null);
  assert.equal(Object.hasOwn(result.pullRequests[0].workItem.reference, "status"), false);
});

test("emits only bounded next-action annotations, never a merge-ready verdict", () => {
  const rows = normalizeOpenPullPages([[
    apiRow({ number: 30, draft: true }),
    apiRow({ number: 29, mergeable_state: "dirty" }),
    apiRow({ number: 28, mergeable_state: "behind" }),
  ]], "Wibias/github-delivery");

  const result = buildOpenWorkStatus({ repository: "Wibias/github-delivery", authenticatedLogin: "Wibias", rows });
  assert.deepEqual(result.pullRequests.map((row) => row.nextAction), ["draft", "resolve-conflicts", "update-base"]);
  assert.ok(result.pullRequests.every((row) => row.mergeReady === undefined));
});
