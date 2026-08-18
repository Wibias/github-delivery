import assert from "node:assert/strict";
import test from "node:test";

import { classifyCoveringPullRequests } from "../../scripts/lib/covering-pr.mjs";

const row = (overrides = {}) => ({
  number: 12,
  url: "https://github.com/Wibias/github-delivery/pull/12",
  state: "open",
  baseRefName: "main",
  headRefName: "feature/p0",
  headRepoFullName: "Wibias/github-delivery",
  targetRepoFullName: "Wibias/github-delivery",
  ...overrides,
});

const input = (rows, overrides = {}) => ({
  intendedRepo: "Wibias/github-delivery",
  intendedHeadRepo: "Wibias/github-delivery",
  intendedHead: "feature/p0",
  intendedBase: "main",
  rows,
  ...overrides,
});

test("reuses exactly one open PR for the same repository, head and base", () => {
  const result = classifyCoveringPullRequests(input([row()]));
  assert.equal(result.state, "reuse");
  assert.equal(result.pullRequest.number, 12);
});

test("allows creation when no exact-head PR exists", () => {
  assert.deepEqual(classifyCoveringPullRequests(input([])), { state: "none", matches: [] });
});

test("fails closed when multiple exact-head PRs match", () => {
  const result = classifyCoveringPullRequests(input([
    row(),
    row({ number: 13, url: "https://github.com/Wibias/github-delivery/pull/13" }),
  ]));

  assert.equal(result.state, "ambiguous");
  assert.deepEqual(result.matches.map((entry) => entry.number), [12, 13]);
});

test("does not fuzzy-match a same-title PR on a different head", () => {
  const result = classifyCoveringPullRequests(input([
    row({ headRefName: "feature/other", title: "same title" }),
  ]));
  assert.equal(result.state, "none");
});

test("does not match the same branch name from a different repository", () => {
  const result = classifyCoveringPullRequests(input([
    row({ headRepoFullName: "Other/fork" }),
  ]));
  assert.equal(result.state, "none");
});

test("is base-sensitive so a deliberate port can target another base", () => {
  const result = classifyCoveringPullRequests(input([
    row({ baseRefName: "release/1.x" }),
  ]));
  assert.equal(result.state, "none");
});

test("normalizes repository identity case-insensitively", () => {
  const result = classifyCoveringPullRequests(input([
    row({ headRepoFullName: "wibias/GITHUB-delivery", targetRepoFullName: "WIBIAS/github-delivery" }),
  ]));
  assert.equal(result.state, "reuse");
});
