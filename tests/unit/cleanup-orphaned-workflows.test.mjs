import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { cleanupOrphanedWorkflowRuns } from "../../scripts/cleanup-orphaned-workflows.mjs";
import { validateWorkflowFile } from "../../scripts/lib/workflow-security.mjs";

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

function baseRoutes(extra) {
  return [
    { path: "/repos/Wibias/github-delivery", body: { default_branch: "main" } },
    {
      path: "/repos/Wibias/github-delivery/contents/.github/workflows?ref=main",
      body: [
        { type: "file", path: ".github/workflows/ci.yml" },
        { type: "file", path: ".github/workflows/cleanup-orphaned-workflows.yml" },
      ],
    },
    ...extra,
  ];
}

async function runWith(routes, options = {}) {
  const calls = [];
  const result = await cleanupOrphanedWorkflowRuns({
    token: "test-token",
    repository: "Wibias/github-delivery",
    fetchImpl: mockFetch(routes, calls),
    log: () => {},
    ...options,
  });
  return { result, calls };
}

test("cleanup workflow is default-branch-only, least-privilege, bounded, and pinned", async () => {
  const path = new URL("../../.github/workflows/cleanup-orphaned-workflows.yml", import.meta.url);
  const source = await readFile(path, "utf8");

  assert.match(source, /schedule:\s*\n\s*- cron: "0 6 \* \* 1"/);
  assert.match(source, /push:\s*\n\s*branches:\s*\n\s*- main/);
  assert.doesNotMatch(source, /workflow_dispatch/);
  assert.match(source, /permissions:\s*\n\s*actions: write\s*\n\s*contents: read/);
  assert.match(source, /timeout-minutes: 10/);
  assert.match(source, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/);
  assert.match(source, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/);
  assert.match(source, /persist-credentials: false/);
  assert.match(source, /run: node scripts\/cleanup-orphaned-workflows\.mjs/);
  assert.deepEqual(validateWorkflowFile(".github/workflows/cleanup-orphaned-workflows.yml", source), []);
});

test("deletes only local workflow histories absent from the default branch", async () => {
  const routes = baseRoutes([
    {
      path: "/repos/Wibias/github-delivery/actions/workflows?per_page=100&page=1",
      body: {
        workflows: [
          { id: 1, name: "CI", path: ".github/workflows/ci.yml" },
          { id: 2, name: "Temporary PR helper", path: ".github/workflows/tmp-pr-helper.yml" },
          { id: 3, name: "Dependabot", path: "dynamic/dependabot/dependabot-updates" },
        ],
      },
    },
    {
      path: "/repos/Wibias/github-delivery/actions/workflows/2/runs?per_page=100&page=1",
      body: { workflow_runs: [{ id: 201, status: "completed" }] },
    },
    { method: "DELETE", path: "/repos/Wibias/github-delivery/actions/runs/201", status: 204 },
  ]);

  const { result, calls } = await runWith(routes);
  assert.equal(result.orphanCandidates, 1);
  assert.equal(result.deletedRuns, 1);
  assert.equal(calls.some((call) => call.includes("dynamic/dependabot")), false);
  assert.equal(routes.length, 0);
});

test("preserves an orphan while a live PR branch still contains the workflow file", async () => {
  const routes = baseRoutes([
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
          id: 202,
          status: "completed",
          head_branch: "agent/pr-77",
          head_repository: { full_name: "Wibias/github-delivery" },
        }],
      },
    },
    {
      path: "/repos/Wibias/github-delivery/contents/.github/workflows/tmp-pr-helper.yml?ref=agent%2Fpr-77",
      body: { type: "file", path: ".github/workflows/tmp-pr-helper.yml" },
    },
  ]);

  const { result, calls } = await runWith(routes);
  assert.equal(result.approvedWorkflows, 0);
  assert.equal(result.deletedRuns, 0);
  assert.equal(calls.some((call) => call.startsWith("DELETE ")), false);
  assert.equal(routes.length, 0);
});

test("cleans a PR workflow after its run branch no longer contains the file", async () => {
  const routes = baseRoutes([
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
          id: 203,
          status: "completed",
          head_branch: "agent/pr-77",
          head_repository: { full_name: "Wibias/github-delivery" },
        }],
      },
    },
    {
      path: "/repos/Wibias/github-delivery/contents/.github/workflows/tmp-pr-helper.yml?ref=agent%2Fpr-77",
      status: 404,
      body: { message: "Not Found" },
    },
    { method: "DELETE", path: "/repos/Wibias/github-delivery/actions/runs/203", status: 204 },
  ]);

  const { result } = await runWith(routes);
  assert.equal(result.approvedWorkflows, 1);
  assert.equal(result.deletedRuns, 1);
  assert.equal(routes.length, 0);
});

test("never deletes an orphan with a non-completed run", async () => {
  const routes = baseRoutes([
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
      body: { workflow_runs: [{ id: 204, status: "in_progress" }] },
    },
  ]);

  const { result, calls } = await runWith(routes);
  assert.equal(result.approvedWorkflows, 0);
  assert.equal(result.deletedRuns, 0);
  assert.equal(calls.some((call) => call.startsWith("DELETE ")), false);
  assert.equal(routes.length, 0);
});

test("preflights every candidate before the first destructive request", async () => {
  const routes = baseRoutes([
    {
      path: "/repos/Wibias/github-delivery/actions/workflows?per_page=100&page=1",
      body: {
        workflows: [
          { id: 2, name: "Old helper A", path: ".github/workflows/tmp-a.yml" },
          { id: 3, name: "Old helper B", path: ".github/workflows/tmp-b.yml" },
        ],
      },
    },
    {
      path: "/repos/Wibias/github-delivery/actions/workflows/2/runs?per_page=100&page=1",
      body: { workflow_runs: [{ id: 205, status: "completed" }] },
    },
    {
      path: "/repos/Wibias/github-delivery/actions/workflows/3/runs?per_page=100&page=1",
      status: 503,
      body: { message: "Service Unavailable" },
    },
  ]);
  const calls = [];

  await assert.rejects(
    cleanupOrphanedWorkflowRuns({
      token: "test-token",
      repository: "Wibias/github-delivery",
      fetchImpl: mockFetch(routes, calls),
      log: () => {},
    }),
    /HTTP 503/,
  );
  assert.equal(calls.some((call) => call.startsWith("DELETE ")), false);
});

test("caps deletions and clears smaller orphan histories first", async () => {
  const routes = baseRoutes([
    {
      path: "/repos/Wibias/github-delivery/actions/workflows?per_page=100&page=1",
      body: {
        workflows: [
          { id: 2, name: "Large helper", path: ".github/workflows/tmp-large.yml" },
          { id: 3, name: "Small helper", path: ".github/workflows/tmp-small.yml" },
        ],
      },
    },
    {
      path: "/repos/Wibias/github-delivery/actions/workflows/2/runs?per_page=100&page=1",
      body: {
        workflow_runs: [
          { id: 206, status: "completed" },
          { id: 207, status: "completed" },
        ],
      },
    },
    {
      path: "/repos/Wibias/github-delivery/actions/workflows/3/runs?per_page=100&page=1",
      body: { workflow_runs: [{ id: 208, status: "completed" }] },
    },
    { method: "DELETE", path: "/repos/Wibias/github-delivery/actions/runs/208", status: 204 },
  ]);

  const { result, calls } = await runWith(routes, { maxDeletions: 1 });
  assert.equal(result.deletedRuns, 1);
  assert.equal(result.capped, true);
  assert.equal(calls.at(-1), "DELETE /repos/Wibias/github-delivery/actions/runs/208");
  assert.equal(routes.length, 0);
});
