import assert from "node:assert/strict";
import test from "node:test";

import { evaluateWakeSnapshot } from "../../scripts/lib/snapshot-evaluators.mjs";
import {
  ADDRESSED_FEEDBACK_INLINE_MAX,
  formatAddressedFeedbackComment,
} from "../../scripts/lib/addressed-feedback-comment.mjs";
import {
  evaluateFeedbackResolutions,
  isTrustedHumanFeedback,
  normalizeFeedback,
  parseFeedbackResolution,
} from "../../scripts/lib/watch-feedback.mjs";

const headOid = "d54ceec1234567890abcdef1234567890abcdef1";
const commitOid = headOid;

function comment({
  id,
  body,
  createdAt,
  login = "maintainer",
  kind = "issue_comment",
} = {}) {
  return normalizeFeedback(
    {
      id,
      body,
      created_at: createdAt,
      user: { login },
      author_association: login === "Wibias" ? "OWNER" : "MEMBER",
      repository_permission: login === "Wibias" ? null : "write",
    },
    kind,
  );
}

const canonicalBody = [
  "[GD] Addressed feedback",
  "",
  "feedbacks:",
  "- issue_comment:101",
  "- review_comment:202",
  "",
  "commit: d54ceec",
  "",
  `<!-- gd:addressed-feedback head:${headOid} -->`,
].join("\n");

test("parses one GD comment that aggregates multiple feedback items", () => {
  const parsed = parseFeedbackResolution(
    comment({
      id: 900,
      login: "Wibias",
      createdAt: "2026-08-03T05:05:00Z",
      body: canonicalBody,
    }),
  );

  assert.ok(parsed);
  assert.equal(parsed.syntaxValid, true);
  assert.deepEqual(parsed.feedbackKeys, [
    "issue_comment:101",
    "review_comment:202",
  ]);
  assert.equal(parsed.commitRef, "d54ceec");
  assert.equal(parsed.headRef, headOid);
});

test("one aggregated resolution comment clears every named feedback item", () => {
  const first = comment({
    id: 101,
    createdAt: "2026-08-03T05:00:00Z",
    body: "Please fix the first issue.",
  });
  const second = comment({
    id: 202,
    kind: "review_comment",
    createdAt: "2026-08-03T05:01:00Z",
    body: "Please fix the second issue.",
  });
  const record = comment({
    id: 900,
    login: "Wibias",
    createdAt: "2026-08-03T05:05:00Z",
    body: canonicalBody,
  });

  const result = evaluateFeedbackResolutions({
    feedback: [first, second, record],
    commits: [
      {
        oid: commitOid,
        authoredDate: "2026-08-03T05:04:00Z",
        message: "fix: address feedback",
      },
    ],
    myLogin: "Wibias",
    headOid,
  });

  assert.deepEqual(result.addressedKeys, [
    "issue_comment:101",
    "review_comment:202",
  ]);
  assert.equal(result.validRecords.length, 1);
  assert.deepEqual(result.validRecords[0].resolvedFeedbackKeys, [
    "issue_comment:101",
    "review_comment:202",
  ]);
  assert.deepEqual(result.unaddressed, []);
});

test("wake output exposes one aggregated addressed-feedback comment per head", () => {
  const completeSource = {
    required: true,
    readable: true,
    complete: true,
    error: null,
  };
  const snapshot = {
    schemaVersion: 1,
    kind: "github-delivery/evidence-snapshot",
    snapshotId: "aggregate-feedback",
    repo: "Wibias/github-delivery",
    pr: 42,
    headOid,
    sources: {
      issueComments: completeSource,
      reviewComments: completeSource,
      reviews: completeSource,
      viewer: completeSource,
    },
    evidence: {
      pullRequest: {
        url: "https://example.test/pr/42",
        headRefOid: headOid,
        mergeStateStatus: "CLEAN",
        mergeable: "MERGEABLE",
        commits: [],
      },
      feedback: {
        issueComments: [
          {
            id: 101,
            user: { login: "maintainer" },
            author_association: "MEMBER",
            repository_permission: "write",
            created_at: "2026-08-03T05:00:00Z",
            body: "Please fix the first issue.",
          },
        ],
        reviewComments: [
          {
            id: 202,
            user: { login: "maintainer" },
            author_association: "MEMBER",
            repository_permission: "write",
            created_at: "2026-08-03T05:01:00Z",
            body: "Please fix the second issue.",
          },
        ],
        reviews: [],
        reviewThreads: [],
      },
      viewer: { login: "Wibias" },
    },
  };

  const result = evaluateWakeSnapshot(snapshot);
  const templates = new Set(result.blockers.map((item) => item.howToClear));

  assert.equal(result.blockers.length, 2);
  assert.equal(templates.size, 1);
  assert.equal(result.addressedFeedbackComment, [...templates][0]);
  assert.match(result.addressedFeedbackComment, /^\[GD\] Addressed feedback/m);
  assert.match(result.addressedFeedbackComment, /- issue_comment:101/);
  assert.match(result.addressedFeedbackComment, /- review_comment:202/);
  assert.match(
    result.addressedFeedbackComment,
    new RegExp(`<!-- gd:addressed-feedback head:${headOid} -->`),
  );
});

test("GD and legacy agent comments are never treated as trusted human feedback", () => {
  const interimPrefix = "[" + ["github", "delivery"].join("-") + "]";
  const oldPrefix = "[" + ["shipping", "github"].join("-") + "]";

  for (const body of [
    canonicalBody,
    `${interimPrefix} Addressed feedback\nfeedback: issue_comment:101\ncommit: d54ceec`,
    `${oldPrefix} Addressed feedback\nfeedback: issue_comment:101\ncommit: d54ceec`,
  ]) {
    assert.equal(
      isTrustedHumanFeedback(
        comment({
          id: body.length,
          createdAt: "2026-08-03T05:05:00Z",
          body,
        }),
      ),
      false,
    );
  }
});

test("a marker for another head cannot clear current-head feedback", () => {
  const target = comment({
    id: 101,
    createdAt: "2026-08-03T05:00:00Z",
    body: "Please fix this.",
  });
  const stale = comment({
    id: 901,
    login: "Wibias",
    createdAt: "2026-08-03T05:05:00Z",
    body: canonicalBody.replace(headOid, "a".repeat(40)),
  });

  const result = evaluateFeedbackResolutions({
    feedback: [target, stale],
    commits: [
      {
        oid: commitOid,
        authoredDate: "2026-08-03T05:04:00Z",
        message: "fix: address feedback",
      },
    ],
    myLogin: "Wibias",
    headOid,
  });

  assert.deepEqual(result.addressedKeys, []);
  assert.ok(
    result.diagnostics.some(
      (item) => item.code === "resolution_head_mismatch",
    ),
  );
});

test("formatAddressedFeedbackComment keeps 5 or fewer keys inline", () => {
  const body = formatAddressedFeedbackComment({
    feedbackKeys: ["review_comment:1", "review_comment:2", "review_comment:3"],
    commitRef: "d54ceec",
    headOid,
  });

  assert.equal(ADDRESSED_FEEDBACK_INLINE_MAX, 5);
  assert.ok(body.startsWith("[GD] Addressed feedback\n\nfeedbacks:\n"));
  assert.match(body, /- review_comment:1/);
  assert.match(body, /- review_comment:2/);
  assert.match(body, /- review_comment:3/);
  assert.match(body, /commit: d54ceec\n/);
  assert.ok(!body.includes("<details>"));

  const parsed = parseFeedbackResolution(comment({ id: 910, body }));
  assert.equal(parsed.syntaxValid, true);
  assert.deepEqual(parsed.feedbackKeys, [
    "review_comment:1",
    "review_comment:2",
    "review_comment:3",
  ]);
  assert.equal(parsed.commitRef, "d54ceec");
  assert.equal(parsed.headRef, headOid);
});

test("formatAddressedFeedbackComment collapses more than 5 keys in a details block", () => {
  const keys = Array.from({ length: 6 }, (_, i) => `review_comment:${i + 1}`);
  const body = formatAddressedFeedbackComment({
    feedbackKeys: keys,
    commitRef: "d54ceec",
    headOid,
  });

  assert.ok(body.startsWith("[GD] Addressed feedback\n\ncommit: d54ceec\n"));
  assert.match(body, /\n<details>\n<summary>feedbacks:<\/summary>\n\n/);
  assert.match(body, /- review_comment:1/);
  assert.match(body, /- review_comment:6/);
  assert.match(body, /\n<\/details>\n/);
  assert.ok(!/^feedbacks:/m.test(body.split("commit:")[0]));

  const parsed = parseFeedbackResolution(comment({ id: 911, body }));
  assert.equal(parsed.syntaxValid, true);
  assert.deepEqual(parsed.feedbackKeys, keys);
  assert.equal(parsed.commitRef, "d54ceec");
  assert.equal(parsed.headRef, headOid);
});

test("wake output uses collapsed details when more than 5 feedback keys are unaddressed", () => {
  const completeSource = {
    required: true,
    readable: true,
    complete: true,
    error: null,
  };
  const snapshot = {
    schemaVersion: 1,
    kind: "github-delivery/evidence-snapshot",
    snapshotId: "collapse-feedback",
    repo: "Wibias/github-delivery",
    pr: 43,
    headOid,
    sources: {
      issueComments: completeSource,
      reviewComments: completeSource,
      reviews: completeSource,
      viewer: completeSource,
    },
    evidence: {
      pullRequest: {
        url: "https://example.test/pr/43",
        headRefOid: headOid,
        mergeStateStatus: "CLEAN",
        mergeable: "MERGEABLE",
        commits: [],
      },
      feedback: {
        issueComments: Array.from({ length: 6 }, (_, i) => ({
          id: 1000 + i,
          user: { login: "maintainer" },
          author_association: "MEMBER",
          repository_permission: "write",
          created_at: `2026-08-03T05:0${i}:00Z`,
          body: `Please fix item ${i}.`,
        })),
        reviewComments: [],
        reviews: [],
        reviewThreads: [],
      },
      viewer: { login: "Wibias" },
    },
  };

  const result = evaluateWakeSnapshot(snapshot);

  assert.equal(result.blockers.length, 6);
  assert.match(result.addressedFeedbackComment, /^\[GD\] Addressed feedback\n\ncommit:/);
  assert.match(result.addressedFeedbackComment, /<details>\n<summary>feedbacks:<\/summary>/);
  assert.match(result.addressedFeedbackComment, /- issue_comment:1000/);
  assert.match(result.addressedFeedbackComment, /- issue_comment:1005/);
});
