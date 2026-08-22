import assert from "node:assert/strict";
import test from "node:test";

import {
  lifecycleCommandFor,
  preflightLifecycleMutation,
  validateLifecycleMutation,
} from "../../scripts/lib/lifecycle-mutations.mjs";
import {
  makeGitHubBodyTransportRunner,
  transportGitHubBody,
} from "../../scripts/lib/github-body-transport.mjs";

function request(overrides = {}) {
  return {
    action: "create_pr",
    repo: "Wibias/github-delivery",
    base: "main",
    head: "feature/p0",
    title: "Add P0 safety",
    body: "Body",
    idempotencyKey: "p0-safety",
    ...overrides,
  };
}

function prRow(overrides = {}) {
  return {
    number: 22,
    url: "https://api.github.com/repos/Wibias/github-delivery/pulls/22",
    html_url: "https://github.com/Wibias/github-delivery/pull/22",
    state: "open",
    head: { ref: "feature/p0", repo: { full_name: "Wibias/github-delivery" } },
    base: { ref: "main", repo: { full_name: "Wibias/github-delivery" } },
    ...overrides,
  };
}

function apiRunner(rows, expectedHead = "Wibias:feature/p0") {
  return (command, args) => {
    assert.equal(command, "gh");
    assert.equal(args[0], "api");
    assert.equal(
      args[1],
      `repos/Wibias/github-delivery/pulls?state=open&head=${encodeURIComponent(expectedHead)}&per_page=100`,
    );
    assert.ok(args.includes("--paginate"));
    assert.ok(args.includes("--slurp"));
    return { status: 0, stdout: JSON.stringify([rows]), stderr: "" };
  };
}

test("create_pr remains valid without a caller-supplied head repository override", () => {
  assert.equal(validateLifecycleMutation(request()), true);
});

test("create_pr rejects a whitespace-only head", () => {
  assert.throws(
    () => validateLifecycleMutation(request({ head: "   " })),
    /head_invalid/,
  );
});

test("create_pr accepts an exact caller-supplied head repository identity", () => {
  assert.equal(validateLifecycleMutation(request({ head: "fork-owner:feature/p0", headRepo: "fork-owner/custom-fork" })), true);
});

test("create_pr accepts a same-repository headRepo with an unqualified head", () => {
  assert.equal(validateLifecycleMutation(request({ headRepo: "wibias/GITHUB-delivery" })), true);
});

test("create_pr rejects a fork headRepo when head omits the required owner qualifier", () => {
  assert.throws(
    () => validateLifecycleMutation(request({ headRepo: "fork-owner/custom-fork" })),
    /head_repo_requires_qualified_head/,
  );
});

test("create_pr rejects an explicit head owner that disagrees with headRepo", () => {
  assert.throws(
    () => validateLifecycleMutation(request({
      head: "fork-owner:feature/p0",
      headRepo: "other-owner/custom-fork",
    })),
    /head_owner_repo_mismatch/,
  );
});

test("create_pr without headRepo keeps the normal gh pr create path", () => {
  const command = lifecycleCommandFor(request({ draft: true }));
  assert.deepEqual(command.slice(0, 3), ["gh", "pr", "create"]);
  assert.ok(command.includes("--head"));
  assert.ok(command.includes("feature/p0"));
  assert.ok(command.includes("--draft"));
});

test("create_pr with headRepo uses REST and passes the exact source repository name", () => {
  const command = lifecycleCommandFor(request({
    head: "fork-owner:feature/p0",
    headRepo: "fork-owner/custom-fork",
    draft: true,
  }));

  assert.deepEqual(command.slice(0, 5), [
    "gh",
    "api",
    "repos/Wibias/github-delivery/pulls",
    "--method",
    "POST",
  ]);
  assert.ok(command.includes("head=fork-owner:feature/p0"));
  assert.ok(command.includes("head_repo=custom-fork"));
  assert.ok(command.includes("base=main"));
  assert.ok(command.includes("draft=true"));

  const transported = transportGitHubBody("gh", command.slice(1), {});
  assert.equal(transported.kind, "api_json_stdin");
  assert.deepEqual(JSON.parse(transported.options.input), {
    title: "Add P0 safety",
    head: "fork-owner:feature/p0",
    head_repo: "custom-fork",
    base: "main",
    body: "Body",
    draft: true,
  });
  assert.ok(transported.args.includes("--input"));
  assert.ok(!transported.args.includes("body=Body"));

  const calls = [];
  const runner = makeGitHubBodyTransportRunner((cmd, args, options) => {
    calls.push({ cmd, args, options });
    return { status: 0, stdout: "{}", stderr: "" };
  });
  runner("gh", command.slice(1), {});
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].options.input).head_repo, "custom-fork");
});

test("blocks creation and reports the browser URL for an existing exact-head/base PR", () => {
  assert.throws(
    () => preflightLifecycleMutation({ request: request(), runner: apiRunner([prRow()]) }),
    /create_pr_existing:22:https:\/\/github\.com\/Wibias\/github-delivery\/pull\/22/,
  );
});

test("allows creation when no exact-head/base PR exists", () => {
  assert.doesNotThrow(() => preflightLifecycleMutation({ request: request(), runner: apiRunner([]) }));
});

test("fails closed when multiple exact-head/base PRs exist", () => {
  assert.throws(
    () => preflightLifecycleMutation({
      request: request(),
      runner: apiRunner([
        prRow(),
        prRow({ number: 23, html_url: "https://github.com/Wibias/github-delivery/pull/23" }),
      ]),
    }),
    /create_pr_ambiguous:22,23/,
  );
});

test("does not block a deliberate PR to a different base", () => {
  assert.doesNotThrow(() => preflightLifecycleMutation({
    request: request(),
    runner: apiRunner([prRow({ base: { ref: "release/1.x", repo: { full_name: "Wibias/github-delivery" } } })]),
  }));
});

test("does not match the same branch name from another head repository", () => {
  assert.doesNotThrow(() => preflightLifecycleMutation({
    request: request(),
    runner: apiRunner([prRow({ head: { ref: "feature/p0", repo: { full_name: "Other/fork" } } })]),
  }));
});

test("explicit fork head repository is enforced exactly", () => {
  const forkRequest = request({
    head: "fork-owner:feature/p0",
    headRepo: "fork-owner/custom-fork",
  });
  const wrongFork = prRow({
    head: { ref: "feature/p0", repo: { full_name: "fork-owner/other-fork" } },
  });
  assert.doesNotThrow(() => preflightLifecycleMutation({
    request: forkRequest,
    runner: apiRunner([wrongFork], "fork-owner:feature/p0"),
  }));

  const rightFork = prRow({
    head: { ref: "feature/p0", repo: { full_name: "fork-owner/custom-fork" } },
  });
  assert.throws(
    () => preflightLifecycleMutation({
      request: forkRequest,
      runner: apiRunner([rightFork], "fork-owner:feature/p0"),
    }),
    /create_pr_existing:22:/,
  );
});
