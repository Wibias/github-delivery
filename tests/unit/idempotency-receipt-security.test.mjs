import assert from "node:assert/strict";
import test from "node:test";

import { executeLifecycleMutationRequest } from "../../scripts/lib/github-lifecycle-mutation-broker.mjs";
import { idempotencyMarker } from "../../scripts/lib/github-mutation-broker.mjs";
import { executeMutationRequest } from "../../scripts/lib/github-mutation-router.mjs";
import { exactIdempotencyRecordMatches } from "../../scripts/lib/idempotency-receipt.mjs";

const HEAD = "a".repeat(40);

function markedBody(body, key) {
  return `${body}\n\n${idempotencyMarker(key)}`;
}

test("exact receipt matcher rejects a PR masquerading as a created issue", () => {
  assert.equal(
    exactIdempotencyRecordMatches({
      actorLogin: "agent",
      request: {
        action: "create_issue",
        title: "Safe issue",
        body: markedBody("Body", "issue-key"),
        idempotencyMarker: idempotencyMarker("issue-key"),
      },
      record: {
        user: { login: "agent" },
        title: "Safe issue",
        body: markedBody("Body", "issue-key"),
        pull_request: { url: "https://api.github.test/pulls/77" },
      },
    }),
    false,
  );
});

test("lifecycle create ignores forged marker records and verifies the exact created issue", () => {
  let created = false;
  let createdBody = null;
  let createCalls = 0;
  const key = "issue-key";
  const marker = idempotencyMarker(key);
  const forgedPr = {
    id: 77,
    number: 77,
    user: { login: "attacker" },
    title: "Safe issue",
    body: `Body\n\n${marker}`,
    pull_request: { url: "https://api.github.test/pulls/77" },
  };

  const result = executeLifecycleMutationRequest({
    request: {
      schemaVersion: 1,
      action: "create_issue",
      mutationMode: "maintainer",
      explicitInstruction: true,
      repo: "acme/widgets",
      title: "Safe issue",
      body: "Body",
      idempotencyKey: key,
    },
    execute: true,
    runner(command, args) {
      if (command === "gh" && args[0] === "api" && String(args[1]).includes("issues?state=all")) {
        const exactIssue = created
          ? [{
              id: 88,
              number: 88,
              user: { login: "agent" },
              title: "Safe issue",
              body: createdBody,
              html_url: "https://github.test/acme/widgets/issues/88",
            }]
          : [];
        return { status: 0, stdout: JSON.stringify([[forgedPr, ...exactIssue]]), stderr: "" };
      }
      if (command === "gh" && args[0] === "api" && args[1] === "user") {
        return { status: 0, stdout: "agent\n", stderr: "" };
      }
      if (command === "gh" && args[0] === "issue" && args[1] === "create") {
        createCalls += 1;
        created = true;
        createdBody = args[args.indexOf("--body") + 1];
        return { status: 0, stdout: "https://github.test/acme/widgets/issues/88\n", stderr: "" };
      }
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    },
  });

  assert.equal(createCalls, 1);
  assert.equal(result.status, "succeeded");
  assert.equal(result.verification.number, 88);
});

test("create_pr idempotency lookup is bounded to the head branch", () => {
  const key = "pr-key";
  let lookupCommand = null;
  let createdBody = null;
  let created = false;

  const result = executeLifecycleMutationRequest({
    request: {
      schemaVersion: 1,
      action: "create_pr",
      mutationMode: "maintainer",
      explicitInstruction: true,
      repo: "acme/widgets",
      base: "main",
      head: "feature/x",
      title: "Add feature",
      body: "Body",
      idempotencyKey: key,
    },
    execute: true,
    runner(command, args) {
      if (command === "gh" && args[0] === "api" && String(args[1]).includes("/pulls?state=all")) {
        lookupCommand = args.join(" ");
        const exactPr = created
          ? [{
              id: 99,
              number: 99,
              user: { login: "agent" },
              title: "Add feature",
              base: { ref: "main" },
              head: { ref: "feature/x", label: "acme:feature/x" },
              body: createdBody,
              html_url: "https://github.test/acme/widgets/pull/99",
            }]
          : [];
        return { status: 0, stdout: JSON.stringify([exactPr]), stderr: "" };
      }
      if (command === "gh" && args[0] === "api" && args[1] === "user") {
        return { status: 0, stdout: "agent\n", stderr: "" };
      }
      if (command === "gh" && args[0] === "pr" && args[1] === "create") {
        created = true;
        createdBody = args[args.indexOf("--body") + 1];
        return { status: 0, stdout: "https://github.test/acme/widgets/pull/99\n", stderr: "" };
      }
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    },
  });

  assert.ok(lookupCommand, "expected a head-filtered idempotency lookup");
  assert.match(lookupCommand, /head=feature%2Fx/);
  assert.equal(result.status, "succeeded");
});

test("social mutation ignores a forged marker from another GitHub actor", () => {
  const key = "comment-key";
  const marker = idempotencyMarker(key);
  let visibleEffects = 0;

  const result = executeMutationRequest({
    request: {
      schemaVersion: 1,
      action: "post_comment",
      mutationMode: "review",
      repo: "acme/widgets",
      pr: 32,
      expectedHead: HEAD,
      body: "Status update",
      idempotencyKey: key,
    },
    execute: true,
    runner(command, args) {
      if (command === "gh" && args[0] === "pr" && args[1] === "view") {
        return { status: 0, stdout: `${HEAD}\n`, stderr: "" };
      }
      if (command === "gh" && args[0] === "api" && String(args[1]).includes("/issues/32/comments")) {
        return {
          status: 0,
          stdout: JSON.stringify([[
            {
              id: 55,
              user: { login: "attacker" },
              body: `Status update\n\n${marker}`,
            },
          ]]),
          stderr: "",
        };
      }
      if (command === "gh" && args[0] === "api" && args[1] === "user") {
        return { status: 0, stdout: "agent\n", stderr: "" };
      }
      if (command === "gh" && args[0] === "pr" && args[1] === "comment") {
        visibleEffects += 1;
        return { status: 0, stdout: "commented\n", stderr: "" };
      }
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    },
  });

  assert.equal(visibleEffects, 1);
  assert.equal(result.status, "succeeded");
  assert.equal(result.existingMutation, null);
});

test("social mutation reuses an exact same-actor receipt", () => {
  const key = "comment-key";
  const marker = idempotencyMarker(key);
  let visibleEffects = 0;

  const result = executeMutationRequest({
    request: {
      schemaVersion: 1,
      action: "post_comment",
      mutationMode: "review",
      repo: "acme/widgets",
      pr: 32,
      expectedHead: HEAD,
      body: "Status update",
      idempotencyKey: key,
    },
    execute: true,
    runner(command, args) {
      if (command === "gh" && args[0] === "pr" && args[1] === "view") {
        return { status: 0, stdout: `${HEAD}\n`, stderr: "" };
      }
      if (command === "gh" && args[0] === "api" && String(args[1]).includes("/issues/32/comments")) {
        return {
          status: 0,
          stdout: JSON.stringify([[
            {
              id: 56,
              user: { login: "agent" },
              body: `Status update\n\n${marker}`,
              html_url: "https://github.test/acme/widgets/pull/32#issuecomment-56",
            },
          ]]),
          stderr: "",
        };
      }
      if (command === "gh" && args[0] === "api" && args[1] === "user") {
        return { status: 0, stdout: "agent\n", stderr: "" };
      }
      if (command === "gh" && args[0] === "pr" && args[1] === "comment") {
        visibleEffects += 1;
        return { status: 0, stdout: "commented\n", stderr: "" };
      }
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    },
  });

  assert.equal(visibleEffects, 0);
  assert.equal(result.status, "already_applied");
  assert.equal(result.existingMutation.id, 56);
});
