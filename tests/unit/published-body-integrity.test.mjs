import assert from "node:assert/strict";
import test from "node:test";

import {
  makeGitHubBodyTransportRunner,
  transportGitHubBody,
} from "../../scripts/lib/github-body-transport.mjs";
import { verifyLifecycleMutation } from "../../scripts/lib/lifecycle-mutations.mjs";
import { verifyLegacyMutationPostcondition } from "../../scripts/lib/mutation-postconditions.mjs";
import {
  inspectPublishedMarkdown,
  repairLiteralEscapes,
} from "../../scripts/lib/published-body-integrity.mjs";

const BACKSLASH = String.fromCharCode(92);
const ESCAPED = ["## Summary", "", "- added a check"].join(BACKSLASH + "n");
const REAL = "## Summary\n\n- added a check";
const MARKER = `<!-- github-delivery:idempotency ${"a".repeat(64)} -->`;
const REAL_WITH_MARKER = `${REAL}\n\n${MARKER}`;
const ESCAPED_WITH_MARKER = ["## Summary", "", "- added a check", "", MARKER].join(
  BACKSLASH + "n",
);

test("detects literal escape sequences that collapse published markdown", () => {
  const inspection = inspectPublishedMarkdown(ESCAPED);
  assert.equal(inspection.ok, false);
  assert.ok(inspection.findings.includes("literal_escape_sequences"));
});

test("accepts real newlines and repairs escaped bodies", () => {
  assert.equal(inspectPublishedMarkdown(REAL).ok, true);
  assert.equal(repairLiteralEscapes(ESCAPED), REAL);
});

test("body transport rejects escaped markdown before GitHub sees it", () => {
  const runner = makeGitHubBodyTransportRunner(() => {
    throw new Error("runner_should_not_execute");
  });
  assert.throws(
    () => runner("gh", ["pr", "create", "--title", "T", "--body", ESCAPED], { encoding: "utf8" }),
    /published_markdown_malformed/,
  );
});

test("body transport still moves large real bodies onto stdin", () => {
  const large = (REAL + "\n").repeat(2000);
  const result = transportGitHubBody("gh", ["pr", "comment", "42", "--body", large], {});
  assert.equal(result.kind, "body_file_stdin");
  assert.equal(result.options.input, large);
});

test("create_pr verification fails closed on a live escaped body", () => {
  const runner = (command, args) => {
    assert.equal(command, "gh");
    assert.equal(args[0], "pr");
    return { status: 0, stdout: ESCAPED, stderr: "" };
  };
  assert.throws(
    () => verifyLifecycleMutation({
      request: {
        action: "create_pr",
        repo: "acme/widgets",
        head: "feature/check",
        body: REAL,
      },
      runner,
    }),
    /published_markdown_malformed/,
  );
});

test("comment postcondition re-reads the live comment and rejects escaped markdown", () => {
  const runner = () => ({
    status: 0,
    stdout: JSON.stringify({ body: ESCAPED, user: { login: "octocat" } }),
    stderr: "",
  });
  assert.throws(
    () => verifyLegacyMutationPostcondition({
      request: {
        action: "post_comment",
        repo: "acme/widgets",
        pr: 42,
        body: REAL,
      },
      receipt: { executed: true, status: "succeeded", verification: { html_url: "https://api.github.com/repos/acme/widgets/issues/comments/9" } },
      runner,
    }),
    /published_markdown_malformed/,
  );
});

const LIVE_BODY_SCENARIOS = [
  {
    action: "post_comment",
    request: { pr: 42 },
    collection: "repos/acme/widgets/issues/42/comments?per_page=100",
  },
  {
    action: "post_resolution_record",
    request: { pr: 42 },
    collection: "repos/acme/widgets/issues/42/comments?per_page=100",
  },
  {
    action: "post_issue_comment",
    request: { issue: 77 },
    collection: "repos/acme/widgets/issues/77/comments?per_page=100",
  },
  {
    action: "reply_bot_thread",
    request: { pr: 42, commentId: 7 },
    collection: "repos/acme/widgets/pulls/42/comments?per_page=100",
    inReplyToId: 7,
  },
  {
    action: "reply_human_thread",
    request: { pr: 42, commentId: 7 },
    collection: "repos/acme/widgets/pulls/42/comments?per_page=100",
    inReplyToId: 7,
  },
  {
    action: "post_review",
    request: { pr: 42 },
    collection: "repos/acme/widgets/pulls/42/reviews?per_page=100",
  },
];

for (const scenario of LIVE_BODY_SCENARIOS) {
  test(`${scenario.action} postcondition re-reads authoritative body when the write receipt has no object id`, () => {
    const calls = [];
    const runner = (command, args) => {
      calls.push([command, ...args]);
      assert.equal(command, "gh");
      if (args[0] === "api" && args[1] === "user") {
        assert.deepEqual(args.slice(2), ["--jq", ".login"]);
        return {
          status: 0,
          stdout: "octocat\n",
          stderr: "",
        };
      }
      if (
        args[0] === "api" &&
        args[1] === scenario.collection &&
        args.includes("--paginate") &&
        args.includes("--slurp")
      ) {
        return {
          status: 0,
          stdout: JSON.stringify([
            [
              {
                id: 9,
                body: ESCAPED_WITH_MARKER,
                user: { login: "octocat" },
                ...(scenario.inReplyToId ? { in_reply_to_id: scenario.inReplyToId } : {}),
              },
            ],
          ]),
          stderr: "",
        };
      }
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    };

    assert.throws(
      () => verifyLegacyMutationPostcondition({
        request: {
          action: scenario.action,
          repo: "acme/widgets",
          body: REAL_WITH_MARKER,
          idempotencyMarker: MARKER,
          ...scenario.request,
        },
        receipt: { executed: true, status: "succeeded", stdout: "" },
        runner,
      }),
      /published_markdown_malformed/,
    );
    assert.ok(
      calls.some((call) => call[0] === "gh" && call[1] === "api" && call[2] === scenario.collection),
      JSON.stringify(calls),
    );
  });
}