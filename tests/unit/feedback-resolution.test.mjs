import assert from "node:assert/strict";
import test from "node:test";

import {
  attachRepositoryPermissions,
  feedbackPermissionLogins,
} from "../../scripts/lib/feedback-authority.mjs";
import { evaluateWakeSnapshot } from "../../scripts/lib/snapshot-evaluators.mjs";
import {
  evaluateFeedbackResolutions,
  findUnaddressedFeedback,
  normalizeFeedback,
  parseFeedbackResolution,
} from "../../scripts/lib/watch-feedback.mjs";

function comment({
  id,
  login = "maintainer",
  association = "OWNER",
  repositoryPermission = null,
  createdAt,
  body,
  kind = "issue_comment",
} = {}) {
  return normalizeFeedback(
    {
      id,
      user: { login },
      author_association: association,
      repository_permission: repositoryPermission,
      created_at: createdAt,
      body,
      html_url: `https://example.test/comments/${id}`,
    },
    kind,
  );
}

function commit(oid, authoredDate, message = "fix: address feedback") {
  return { oid, authoredDate, message };
}

function resolution({
  id = 900,
  feedbackKey = "review_comment:77",
  commitRef = "abcdef1",
  createdAt = "2026-08-01T00:03:00Z",
  login = "Wibias",
  body,
} = {}) {
  return comment({
    id,
    login,
    createdAt,
    body:
      body ??
      `[GD] Addressed feedback\nfeedback: ${feedbackKey}\ncommit: ${commitRef}`,
  });
}

const target = comment({
  id: 77,
  kind: "review_comment",
  createdAt: "2026-08-01T00:00:00Z",
  body: "Please add the missing regression test.",
});
const fixCommit = commit(
  "abcdef1234567890abcdef1234567890abcdef12",
  "2026-08-01T00:02:00Z",
);

test("parses one structured feedback resolution record", () => {
  const parsed = parseFeedbackResolution(resolution());
  assert.equal(parsed.feedbackKey, "review_comment:77");
  assert.equal(parsed.commitRef, "abcdef1");
  assert.equal(parsed.syntaxValid, true);
});

test("a valid exact record clears only the named feedback item", () => {
  const other = comment({
    id: 78,
    kind: "review_comment",
    createdAt: "2026-08-01T00:00:30Z",
    body: "Please document the edge case too.",
  });
  const result = evaluateFeedbackResolutions({
    feedback: [target, other, resolution()],
    commits: [fixCommit],
    myLogin: "Wibias",
  });
  assert.deepEqual(result.addressedKeys, ["review_comment:77"]);
  assert.deepEqual(
    result.unaddressed.map((item) => item.key),
    ["review_comment:78"],
  );
  assert.deepEqual(result.diagnostics, []);
});

test("organization membership alone is not repository maintainer authority", () => {
  const readOnlyMember = comment({
    id: 801,
    association: "MEMBER",
    repositoryPermission: "read",
    createdAt: "2026-08-01T00:00:00Z",
    body: "Please change this implementation.",
  });
  const writeMember = comment({
    id: 802,
    association: "MEMBER",
    repositoryPermission: "write",
    createdAt: "2026-08-01T00:00:00Z",
    body: "Please change this implementation.",
  });
  assert.deepEqual(
    findUnaddressedFeedback({ feedback: [readOnlyMember], myLogin: "Wibias" }),
    [],
  );
  assert.deepEqual(
    findUnaddressedFeedback({ feedback: [writeMember], myLogin: "Wibias" }).map(
      (item) => item.key,
    ),
    ["issue_comment:802"],
  );
});

test("permission enrichment targets only association classes that need repository authority", () => {
  const source = {
    readable: true,
    complete: true,
    pages: 1,
    error: null,
    rows: [
      { id: 1, user: { login: "reader" }, author_association: "MEMBER" },
      { id: 2, user: { login: "owner" }, author_association: "OWNER" },
      { id: 3, user: { login: "external" }, author_association: "CONTRIBUTOR" },
    ],
  };
  assert.deepEqual(feedbackPermissionLogins([source]), ["reader"]);
  const enriched = attachRepositoryPermissions(source, { reader: "read" });
  assert.equal(enriched.rows[0].repository_permission, "read");
  assert.equal(enriched.rows[1].repository_permission, undefined);
  assert.equal(enriched.rows[2].repository_permission, undefined);
});

test("an unrelated later commit does not clear feedback without a record", () => {
  const unresolved = findUnaddressedFeedback({
    feedback: [target],
    commits: [fixCommit],
    myLogin: "Wibias",
  });
  assert.deepEqual(unresolved.map((item) => item.key), ["review_comment:77"]);
});

test("a resolution for an unknown feedback key is diagnostic and clears nothing", () => {
  const result = evaluateFeedbackResolutions({
    feedback: [target, resolution({ feedbackKey: "review_comment:999" })],
    commits: [fixCommit],
    myLogin: "Wibias",
  });
  assert.deepEqual(result.addressedKeys, []);
  assert.ok(result.diagnostics.some((item) => item.code === "feedback_not_found"));
});

test("a missing or ambiguous commit reference is rejected", () => {
  const missing = evaluateFeedbackResolutions({
    feedback: [target, resolution({ commitRef: "1234567" })],
    commits: [fixCommit],
    myLogin: "Wibias",
  });
  assert.ok(missing.diagnostics.some((item) => item.code === "commit_not_found"));

  const ambiguous = evaluateFeedbackResolutions({
    feedback: [target, resolution({ commitRef: "abcdef1" })],
    commits: [
      fixCommit,
      commit(
        "abcdef1fffffffffffffffffffffffffffffffff",
        "2026-08-01T00:02:30Z",
      ),
    ],
    myLogin: "Wibias",
  });
  assert.ok(ambiguous.diagnostics.some((item) => item.code === "commit_ambiguous"));
});

test("commit and record ordering must prove the fix happened after feedback", () => {
  const beforeFeedback = evaluateFeedbackResolutions({
    feedback: [target, resolution()],
    commits: [
      commit(
        "abcdef1234567890abcdef1234567890abcdef12",
        "2026-07-31T23:59:00Z",
      ),
    ],
    myLogin: "Wibias",
  });
  assert.ok(
    beforeFeedback.diagnostics.some(
      (item) => item.code === "commit_not_after_feedback",
    ),
  );

  const recordBeforeCommit = evaluateFeedbackResolutions({
    feedback: [
      target,
      resolution({ createdAt: "2026-08-01T00:01:00Z" }),
    ],
    commits: [fixCommit],
    myLogin: "Wibias",
  });
  assert.ok(
    recordBeforeCommit.diagnostics.some(
      (item) => item.code === "resolution_before_commit",
    ),
  );
});

test("merge commits and records from another author cannot clear feedback", () => {
  const merge = evaluateFeedbackResolutions({
    feedback: [target, resolution()],
    commits: [
      commit(
        "abcdef1234567890abcdef1234567890abcdef12",
        "2026-08-01T00:02:00Z",
        "Merge branch 'main' into feature",
      ),
    ],
    myLogin: "Wibias",
  });
  assert.ok(merge.diagnostics.some((item) => item.code === "commit_is_merge"));

  const wrongAuthor = evaluateFeedbackResolutions({
    feedback: [target, resolution({ login: "someone-else" })],
    commits: [fixCommit],
    myLogin: "Wibias",
  });
  assert.ok(
    wrongAuthor.diagnostics.some(
      (item) => item.code === "resolution_author_mismatch",
    ),
  );
});

test("malformed records are reported and never clear feedback", () => {
  const malformed = resolution({
    body: "[GD] Addressed feedback\nfeedback: review_comment:77",
  });
  const result = evaluateFeedbackResolutions({
    feedback: [target, malformed],
    commits: [fixCommit],
    myLogin: "Wibias",
  });
  assert.ok(
    result.diagnostics.some(
      (item) => item.code === "malformed_resolution_record",
    ),
  );
  assert.deepEqual(result.addressedKeys, []);
});

test("snapshot wake evaluation exposes valid resolution evidence", () => {
  const completeSource = { required: true, readable: true, complete: true, error: null };
  const snapshot = {
    schemaVersion: 1,
    kind: "github-delivery/evidence-snapshot",
    snapshotId: "resolution-snapshot",
    repo: "Wibias/github-delivery",
    pr: 42,
    headOid: fixCommit.oid,
    sources: {
      issueComments: completeSource,
      reviewComments: completeSource,
      reviews: completeSource,
      viewer: completeSource,
    },
    evidence: {
      pullRequest: {
        url: "https://example.test/pr/42",
        headRefOid: fixCommit.oid,
        mergeStateStatus: "CLEAN",
        mergeable: "MERGEABLE",
        commits: [
          {
            oid: fixCommit.oid,
            messageHeadline: fixCommit.message,
            committedDate: fixCommit.authoredDate,
          },
        ],
      },
      feedback: {
        issueComments: [
          {
            id: 900,
            user: { login: "Wibias" },
            author_association: "OWNER",
            created_at: "2026-08-01T00:03:00Z",
            body: "[GD] Addressed feedback\nfeedback: review_comment:77\ncommit: abcdef1",
          },
        ],
        reviewComments: [
          {
            id: 77,
            user: { login: "maintainer" },
            author_association: "MEMBER",
            repository_permission: "write",
            created_at: "2026-08-01T00:00:00Z",
            body: "Please add the missing regression test.",
          },
        ],
        reviews: [],
        reviewThreads: [],
      },
      viewer: { login: "Wibias" },
    },
  };

  const result = evaluateWakeSnapshot(snapshot);
  assert.equal(result.decision, "ready");
  assert.deepEqual(result.addressedFeedbackKeys, ["review_comment:77"]);
  assert.equal(result.resolutionRecords[0].resolvedCommitOid, fixCommit.oid);
});

test("an invalid feedback timestamp becomes a diagnostic instead of throwing", () => {
  const malformedTimestampTarget = comment({
    id: 79,
    kind: "review_comment",
    createdAt: "not-a-timestamp",
    body: "Please fix this too.",
  });
  const result = evaluateFeedbackResolutions({
    feedback: [
      malformedTimestampTarget,
      resolution({ feedbackKey: "review_comment:79" }),
    ],
    commits: [fixCommit],
    myLogin: "Wibias",
  });
  assert.deepEqual(result.addressedKeys, []);
  assert.ok(
    result.diagnostics.some(
      (item) =>
        item.code === "timestamp_invalid" &&
        item.feedbackKey === "review_comment:79",
    ),
  );
});
