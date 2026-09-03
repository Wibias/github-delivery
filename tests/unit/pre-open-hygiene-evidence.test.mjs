import assert from "node:assert/strict";
import test from "node:test";

import {
  preOpenHygieneReceipts,
  validatePreOpenHygieneEvidence,
} from "../../scripts/lib/pre-open-hygiene-evidence.mjs";
import { parseRemoteBranchHead } from "../../scripts/lib/branch-review-input.mjs";

const HEAD = "b".repeat(40);

function evidence(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "github-delivery/pre-open-hygiene-evidence",
    headSha: HEAD,
    passes: {
      "no-comments": {
        outcome: "clean",
        method: "comment-inspector",
        scopeKind: "diff-added-lines",
        resultValid: true,
        workspaceVerified: true,
      },
      simplify: {
        outcome: "clean",
        method: "simplify-pass",
        validationPassed: true,
      },
    },
    ...overrides,
  };
}

test("validated hygiene evidence produces current-head checkpoint receipts", () => {
  const validated = validatePreOpenHygieneEvidence(evidence(), { headSha: HEAD });
  assert.equal(validated.passes["no-comments"].scopeKind, "diff-added-lines");
  const receipts = preOpenHygieneReceipts(validated, { headSha: HEAD, now: () => 123 });
  assert.deepEqual(receipts, {
    noComments: {
      status: "done",
      headSha: HEAD,
      source: "pre-open-gate",
      outcome: "clean",
      method: "comment-inspector",
      recordedAt: 123,
    },
    simplify: {
      status: "done",
      headSha: HEAD,
      source: "pre-open-gate",
      outcome: "clean",
      method: "simplify-pass",
      recordedAt: 123,
    },
  });
});

test("no-comments hygiene cannot claim completion without diff scope, final result, and byte verification", () => {
  for (const mutation of [
    { scopeKind: "whole-files" },
    { resultValid: false },
    { workspaceVerified: false },
  ]) {
    const value = evidence();
    Object.assign(value.passes["no-comments"], mutation);
    assert.throws(() => validatePreOpenHygieneEvidence(value, { headSha: HEAD }), /pre_open_hygiene_no_comments_/);
  }
});

test("hygiene evidence is head-bound and opt-outs require an explicit reason", () => {
  assert.throws(
    () => validatePreOpenHygieneEvidence(evidence(), { headSha: "c".repeat(40) }),
    /pre_open_hygiene_head_mismatch/,
  );
  const value = evidence();
  value.passes.simplify = { outcome: "skipped", method: "opt-out" };
  assert.throws(
    () => validatePreOpenHygieneEvidence(value, { headSha: HEAD }),
    /pre_open_hygiene_simplify_skip_invalid/,
  );
});

test("remote branch head parser accepts one exact branch row and rejects ambiguity", () => {
  const sha = "a".repeat(40);
  assert.equal(parseRemoteBranchHead(`${sha}\trefs/heads/main\n`), sha);
  assert.throws(() => parseRemoteBranchHead(""), /pre_open_remote_base_unresolved/);
  assert.throws(
    () => parseRemoteBranchHead(`${sha}\trefs/heads/main\n${"b".repeat(40)}\trefs/heads/main\n`),
    /pre_open_remote_base_unresolved/,
  );
});
