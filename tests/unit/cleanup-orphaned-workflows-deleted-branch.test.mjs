import assert from "node:assert/strict";
import test from "node:test";

import { cleanupOrphanedWorkflowRuns } from "../../scripts/cleanup-orphaned-workflows.mjs";

function mockFetch(routes, calls) {
  return async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const method = init.method ?? "GET";
    const key = `${method} ${url.pathname}${url.search}`;
    calls.push(key);

    const index = routes.findIndex(
      (route) => (route.method ?? "GET") === method && route.path === `${url.pathname}${url.search}`,
    );
    if (index < 0) return new Response(`Unexpected request: ${key}`, { status: 500 });

    const [route] = routes.splice(index, 1);
    const status = route.status ?? 200;
    if (status === 204) return new Response(null, { status });
    return Response.json(route.body ?? {}, { status });
  };
}

function deletedBranchRoutes({ recreated = false } = {}) {
  const mainSha = "a".repeat(40);
  const recreatedSha = "b".repeat(40);
  const branchPath = "/repos/Wibias/github-delivery/git/ref/heads/fix/off-mode-never-hello";
  return [
    { path: "/repos/Wibias/github-delivery", body: { default_branch: "main" } },
    { path: "/repos/Wibias/github-delivery/git/ref/heads/main", body: { object: { sha: mainSha } } },
    {
      path: "/repos/Wibias/github-delivery/contents/.github/workflows?ref=main",
      body: [{ type: "file", path: ".github/workflows/ci.yml" }],
    },
    {
      path: "/repos/Wibias/github-delivery/actions/workflows?per_page=100&page=1",
      body: {
        workflows: [
          { id: 2, name: "Temporary PR helper", path: ".github/workflows/tmp-pr-helper.yml" },
        ],
      },
    },
    {
      path: "/repos/Wibias/github-delivery/actions/workflows/2/runs?per_page=100&page=1",
      body: {
        workflow_runs: [{
          id: 401,
          status: "completed",
          head_branch: "fix/off-mode-never-hello",
          head_repository: { full_name: "Wibias/github-delivery" },
        }],
      },
    },
    { path: branchPath, status: 404, body: { message: "Not Found" } },
    { path: "/repos/Wibias/github-delivery/git/ref/heads/main", body: { object: { sha: mainSha } } },
    recreated
      ? { path: branchPath, body: { object: { sha: recreatedSha } } }
      : { path: branchPath, status: 404, body: { message: "Not Found" } },
    ...(recreated ? [] : [
      { method: "DELETE", path: "/repos/Wibias/github-delivery/actions/runs/401", status: 204 },
    ]),
  ];
}

async function cleanupWith(routes) {
  const calls = [];
  const result = await cleanupOrphanedWorkflowRuns({
    token: "test-token",
    repository: "Wibias/github-delivery",
    fetchImpl: mockFetch(routes, calls),
    log: () => {},
  });
  return { result, calls };
}

test("cleans a completed orphan run when its head branch was already deleted", async () => {
  const routes = deletedBranchRoutes();
  const { result, calls } = await cleanupWith(routes);

  assert.equal(result.approvedWorkflows, 1);
  assert.equal(result.deletedRuns, 1);
  assert.equal(calls.includes("DELETE /repos/Wibias/github-delivery/actions/runs/401"), true);
  assert.equal(routes.length, 0);
});

test("fails closed if an absent run-head branch is recreated before deletion", async () => {
  const routes = deletedBranchRoutes({ recreated: true });
  const calls = [];

  await assert.rejects(
    cleanupOrphanedWorkflowRuns({
      token: "test-token",
      repository: "Wibias/github-delivery",
      fetchImpl: mockFetch(routes, calls),
      log: () => {},
    }),
    /run_head_recreated_during_cleanup/,
  );
  assert.equal(calls.some((call) => call.startsWith("DELETE ")), false);
  assert.equal(routes.length, 0);
});
