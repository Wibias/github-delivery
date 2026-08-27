import assert from "node:assert/strict";
import test from "node:test";

import {
  authorityScopeForRequest,
  authorityScopeSha256,
} from "../../scripts/lib/authority-scope.mjs";
import {
  executeMutationRequest,
  idempotencyMarker,
  planMutationRequest,
} from "../../scripts/lib/github-mutation-broker.mjs";
import { mutationProfile } from "../../scripts/lib/mutation-policy.mjs";

const HEAD = "abcdef1234567890abcdef1234567890abcdef12";

function reviewRequest(overrides = {}) {
  return {
    schemaVersion: 1,
    action: "post_review",
    mutationMode: "review",
    repo: "acme/widgets",
    pr: 32,
    expectedHead: HEAD,
    idempotencyKey: "native-review-32",
    body: "Native review sidecar: changes-requested on this head.",
    ...overrides,
  };
}

function dismissRequest(overrides = {}) {
  return {
    schemaVersion: 1,
    action: "dismiss_review",
    mutationMode: "review",
    repo: "acme/widgets",
    pr: 32,
    expectedHead: HEAD,
    reviewId: "PRR_owned",
    actorLogin: "reviewer",
    message: "Superseded by a later github-delivery review pass.",
    ...overrides,
  };
}

function reviewPayload({
  id = "PRR_owned",
  state = "CHANGES_REQUESTED",
  author = "reviewer",
  pr = 32,
  repo = "acme/widgets",
  head = HEAD,
} = {}) {
  return JSON.stringify({
    data: {
      node: {
        id,
        state,
        author: { login: author },
        pullRequest: {
          number: pr,
          headRefOid: head,
          repository: { nameWithOwner: repo },
        },
      },
    },
  });
}

function viewerPayload(login = "reviewer") {
  return JSON.stringify({ login });
}

test("post_review supports comment and request-changes but not native approve", () => {
  const commentPlan = planMutationRequest(reviewRequest());
  assert.ok(commentPlan.command.includes("--comment"));
  assert.equal(commentPlan.command.includes("--request-changes"), false);
  assert.equal(commentPlan.command.includes("--approve"), false);

  const requestPlan = planMutationRequest(
    reviewRequest({ event: "request-changes", idempotencyKey: "native-review-32-rc" }),
  );
  assert.ok(requestPlan.command.includes("--request-changes"));
  assert.equal(requestPlan.command.includes("--comment"), false);
  assert.equal(requestPlan.command.includes("--approve"), false);

  assert.throws(
    () => planMutationRequest(
      reviewRequest({ event: "approve", idempotencyKey: "native-review-32-approve" }),
    ),
    /review_event_invalid/,
  );
});

test("native review fields reject non-string values instead of coercing them", () => {
  assert.throws(
    () => planMutationRequest(reviewRequest({ event: ["request-changes"] })),
    /review_event_invalid/,
  );
  assert.throws(
    () => planMutationRequest(dismissRequest({ reviewId: ["PRR_owned"] })),
    /review_id_invalid/,
  );
  assert.throws(
    () => authorityScopeForRequest(dismissRequest({ actorLogin: { login: "reviewer" } })),
    /actor_login_invalid/,
  );
  assert.throws(
    () => authorityScopeForRequest(dismissRequest({ message: 42 })),
    /message_invalid/,
  );
});

test("request-changes and comment reviews do not share an authority grant", () => {
  const comment = reviewRequest();
  const requested = reviewRequest({ event: "request-changes" });
  assert.equal(authorityScopeForRequest(comment).event, "comment");
  assert.equal(authorityScopeForRequest(requested).event, "request-changes");
  assert.notEqual(authorityScopeSha256(comment), authorityScopeSha256(requested));
  assert.equal(
    authorityScopeSha256(comment),
    authorityScopeSha256(reviewRequest({ event: "comment" })),
  );
});

test("review mode can dismiss a review", () => {
  const profile = mutationProfile("review");
  assert.equal(profile.actions.dismiss_review.allowed, true);
});

test("dismiss_review plans the registered GraphQL mutation and refuses at-file ids", () => {
  const plan = planMutationRequest(dismissRequest());
  assert.ok(plan.command.includes("graphql"));
  assert.ok(plan.command.some((part) => String(part).includes("dismissPullRequestReview")));
  assert.ok(plan.command.includes("id=PRR_owned"));
  assert.throws(
    () => planMutationRequest(dismissRequest({ reviewId: "@secret.txt" })),
    /review_id_at_file/,
  );
  assert.throws(
    () => planMutationRequest(dismissRequest({ message: "@secret.txt" })),
    /message_at_file/,
  );
});

test("dismiss_review refuses another author's pending review before mutation", () => {
  const calls = [];
  assert.throws(
    () =>
      executeMutationRequest({
        request: dismissRequest(),
        execute: true,
        runner(command, args) {
          calls.push([command, ...args]);
          if (args[0] === "pr" && args[1] === "view") {
            return { status: 0, stdout: `${HEAD}\n`, stderr: "" };
          }
          if (args[0] === "api" && args[1] === "user") {
            return { status: 0, stdout: viewerPayload(), stderr: "" };
          }
          if (args[0] === "api" && args[1] === "graphql") {
            return {
              status: 0,
              stdout: reviewPayload({ author: "someone-else" }),
              stderr: "",
            };
          }
          throw new Error(`unexpected write: ${command} ${args.join(" ")}`);
        },
      }),
    /review_not_owned_by_actor/,
  );
  assert.equal(
    calls.some((call) => call.some((arg) => String(arg).includes("dismissPullRequestReview"))),
    false,
  );
});

test("dismiss_review binds ownership to the authenticated viewer, not request actorLogin", () => {
  const calls = [];
  assert.throws(
    () =>
      executeMutationRequest({
        request: dismissRequest({ actorLogin: "someone-else" }),
        execute: true,
        runner(command, args) {
          calls.push([command, ...args]);
          if (args[0] === "pr" && args[1] === "view") {
            return { status: 0, stdout: `${HEAD}\n`, stderr: "" };
          }
          if (args[0] === "api" && args[1] === "user") {
            return { status: 0, stdout: viewerPayload("reviewer"), stderr: "" };
          }
          if (args[0] === "api" && args[1] === "graphql") {
            const queryArg = args.find((arg) => String(arg).startsWith("query=")) || "";
            if (queryArg.includes("dismissPullRequestReview")) {
              throw new Error("unexpected dismiss mutation");
            }
            return {
              status: 0,
              stdout: reviewPayload({ author: "someone-else" }),
              stderr: "",
            };
          }
          throw new Error(`unexpected write: ${command} ${args.join(" ")}`);
        },
      }),
    /review_not_owned_by_actor/,
  );
  assert.equal(
    calls.some((call) => call.some((arg) => String(arg).includes("dismissPullRequestReview"))),
    false,
  );
});

test("already dismissed reviews return already_applied without mutation", () => {
  const result = executeMutationRequest({
    request: dismissRequest(),
    execute: true,
    runner(command, args) {
      if (args[0] === "pr" && args[1] === "view") {
        return { status: 0, stdout: `${HEAD}\n`, stderr: "" };
      }
      if (args[0] === "api" && args[1] === "user") {
        return { status: 0, stdout: viewerPayload(), stderr: "" };
      }
      if (args[0] === "api" && args[1] === "graphql") {
        const queryArg = args.find((arg) => String(arg).startsWith("query=")) || "";
        if (queryArg.includes("dismissPullRequestReview")) {
          throw new Error("unexpected dismiss mutation");
        }
        return {
          status: 0,
          stdout: reviewPayload({ state: "DISMISSED" }),
          stderr: "",
        };
      }
      throw new Error(`unexpected write: ${command} ${args.join(" ")}`);
    },
  });
  assert.equal(result.status, "already_applied");
  assert.equal(result.executed, false);
});

test("successful dismiss verifies the same review is DISMISSED", () => {
  let reads = 0;
  const result = executeMutationRequest({
    request: dismissRequest(),
    execute: true,
    runner(command, args) {
      if (args[0] === "pr" && args[1] === "view") {
        return { status: 0, stdout: `${HEAD}\n`, stderr: "" };
      }
      if (args[0] === "api" && args[1] === "user") {
        return { status: 0, stdout: viewerPayload(), stderr: "" };
      }
      if (args[0] === "api" && args[1] === "graphql") {
        const queryArg = args.find((arg) => String(arg).startsWith("query=")) || "";
        if (queryArg.includes("dismissPullRequestReview")) {
          return {
            status: 0,
            stdout: JSON.stringify({
              data: {
                dismissPullRequestReview: {
                  pullRequestReview: { id: "PRR_owned", state: "DISMISSED" },
                },
              },
            }),
            stderr: "",
          };
        }
        reads += 1;
        return {
          status: 0,
          stdout: reviewPayload({
            state: reads > 1 ? "DISMISSED" : "CHANGES_REQUESTED",
          }),
          stderr: "",
        };
      }
      throw new Error(`unexpected write: ${command} ${args.join(" ")}`);
    },
  });
  assert.equal(result.status, "succeeded");
  assert.equal(result.executed, true);
  assert.equal(result.reviewTarget.state, "DISMISSED");
});

test("a dismissed same-head Request changes review does not suppress a fresh request", () => {
  const request = reviewRequest({
    event: "request-changes",
    idempotencyKey: `native-review-sidecar:32:${HEAD}:request-changes`,
  });
  const marker = idempotencyMarker(request.idempotencyKey);
  let writes = 0;
  const result = executeMutationRequest({
    request,
    execute: true,
    runner(command, args) {
      if (args[0] === "pr" && args[1] === "view") {
        return { status: 0, stdout: `${HEAD}\n`, stderr: "" };
      }
      if (
        args[0] === "api" &&
        String(args[1]).startsWith("repos/acme/widgets/pulls/32/reviews?")
      ) {
        return {
          status: 0,
          stdout: JSON.stringify([
            [
              {
                id: 77,
                state: "DISMISSED",
                body: `old request\n\n${marker}`,
              },
            ],
          ]),
          stderr: "",
        };
      }
      if (args[0] === "pr" && args[1] === "review") {
        writes += 1;
        assert.ok(args.includes("--request-changes"));
        return { status: 0, stdout: "", stderr: "" };
      }
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    },
  });
  assert.equal(result.status, "succeeded");
  assert.equal(result.executed, true);
  assert.equal(writes, 1);
});
