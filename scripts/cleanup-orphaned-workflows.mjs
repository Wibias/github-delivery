import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const API_ROOT = "https://api.github.com";
const LOCAL_WORKFLOW_PREFIX = ".github/workflows/";
const DEFAULT_MAX_DELETIONS = 500;
const COMMIT_SHA_RE = /^[0-9a-f]{40}$/i;

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function parseRepository(repository) {
  if (typeof repository !== "string") {
    throw new Error("GITHUB_REPOSITORY is required");
  }
  const [owner, repo, ...rest] = repository.split("/");
  if (!owner || !repo || rest.length > 0) {
    throw new Error(`GITHUB_REPOSITORY must be owner/repo, got ${JSON.stringify(repository)}`);
  }
  return { owner, repo };
}

class GitHubHttpError extends Error {
  constructor(status, method, path, body) {
    const detail = body.trim();
    super(`${method} ${path} failed with HTTP ${status}${detail ? `: ${detail}` : ""}`);
    this.name = "GitHubHttpError";
    this.status = status;
  }
}

function httpError(status, method, path, body) {
  return new GitHubHttpError(status, method, path, body);
}

export function createGitHubClient({ token, fetchImpl = fetch, apiRoot = API_ROOT }) {
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };

  async function request(path, init = {}) {
    const method = init.method ?? "GET";
    const response = await fetchImpl(`${apiRoot}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers ?? {}) },
    });
    if (!response.ok) {
      throw httpError(response.status, method, path, await response.text());
    }
    if (response.status === 204) return undefined;
    return response.json();
  }

  async function exists(path) {
    const response = await fetchImpl(`${apiRoot}${path}`, { headers });
    if (response.status === 404) return false;
    if (!response.ok) {
      throw httpError(response.status, "GET", path, await response.text());
    }
    return true;
  }

  async function paginate(path, key) {
    const rows = [];
    for (let page = 1; ; page += 1) {
      const separator = path.includes("?") ? "&" : "?";
      const data = await request(`${path}${separator}per_page=100&page=${page}`);
      const items = data?.[key];
      if (!Array.isArray(items)) {
        throw new Error(`GET ${path} did not return an array at ${key}`);
      }
      rows.push(...items);
      if (items.length < 100) return rows;
    }
  }

  return { request, exists, paginate };
}

async function readBranchGeneration({ client, owner, repo, branch }) {
  const payload = await client.request(
    `/repos/${owner}/${repo}/git/ref/heads/${encodePath(branch)}`,
  );
  const sha = String(payload?.object?.sha || "").toLowerCase();
  if (!COMMIT_SHA_RE.test(sha)) {
    throw new Error(`default_branch_generation_invalid:${branch}`);
  }
  return sha;
}

async function workflowStillExistsOnRunHead({ client, owner, repo, workflow, runs, log }) {
  const heads = new Map();
  for (const run of runs) {
    const fullName = run.head_repository?.full_name;
    const branch = run.head_branch;
    if (typeof fullName !== "string" || typeof branch !== "string" || !branch) continue;
    heads.set(`${fullName}\0${branch}`, { fullName, branch });
  }

  for (const { fullName, branch } of heads.values()) {
    const [headOwner, headRepo, ...rest] = fullName.split("/");
    if (!headOwner || !headRepo || rest.length > 0) {
      throw new Error(
        `Workflow run returned invalid head_repository.full_name: ${JSON.stringify(fullName)}`,
      );
    }

    const exists = await client.exists(
      `/repos/${encodeURIComponent(headOwner)}/${encodeURIComponent(headRepo)}`
      + `/contents/${encodePath(workflow.path)}?ref=${encodeURIComponent(branch)}`,
    );
    if (exists) {
      log(
        `Preserving ${workflow.name} (${workflow.path}): `
        + `branch ${fullName}:${branch} still contains it.`,
      );
      return true;
    }
  }

  return false;
}

export async function cleanupOrphanedWorkflowRuns({
  token,
  repository,
  fetchImpl = fetch,
  apiRoot = API_ROOT,
  maxDeletions = DEFAULT_MAX_DELETIONS,
  log = console.log,
}) {
  if (!token) throw new Error("GITHUB_TOKEN is required");
  if (!Number.isInteger(maxDeletions) || maxDeletions < 1) {
    throw new Error(`maxDeletions must be a positive integer, got ${maxDeletions}`);
  }

  const { owner, repo } = parseRepository(repository);
  const client = createGitHubClient({ token, fetchImpl, apiRoot });

  const repositoryData = await client.request(`/repos/${owner}/${repo}`);
  const defaultBranch = repositoryData.default_branch;
  if (!defaultBranch) {
    throw new Error("Repository response did not include default_branch");
  }
  const defaultBranchGeneration = await readBranchGeneration({
    client,
    owner,
    repo,
    branch: defaultBranch,
  });

  const workflowEntries = await client.request(
    `/repos/${owner}/${repo}/contents/.github/workflows?ref=${encodeURIComponent(defaultBranch)}`,
  );
  if (!Array.isArray(workflowEntries)) {
    throw new Error("Default branch .github/workflows response was not a directory listing");
  }

  const activePaths = new Set(
    workflowEntries
      .filter((entry) => entry?.type === "file" && typeof entry.path === "string")
      .map((entry) => entry.path),
  );

  const workflows = await client.paginate(`/repos/${owner}/${repo}/actions/workflows`, "workflows");
  const candidates = workflows.filter(
    (workflow) =>
      typeof workflow?.path === "string"
      && workflow.path.startsWith(LOCAL_WORKFLOW_PREFIX)
      && !activePaths.has(workflow.path),
  );

  log(
    `Found ${workflows.length} workflow records, ${activePaths.size} active default-branch workflow files, `
    + `and ${candidates.length} orphan candidates.`,
  );

  // Complete every read and live-branch check before the first destructive request.
  // A failed preflight therefore cannot leave a partially-cleaned set based on stale evidence.
  const cleanupPlans = [];
  for (const workflow of candidates) {
    const runs = await client.paginate(
      `/repos/${owner}/${repo}/actions/workflows/${workflow.id}/runs`,
      "workflow_runs",
    );

    const nonCompleted = runs.filter((run) => run.status !== "completed");
    if (nonCompleted.length > 0) {
      log(
        `Preserving ${workflow.name} (${workflow.path}): `
        + `${nonCompleted.length} run(s) are not completed.`,
      );
      continue;
    }

    if (await workflowStillExistsOnRunHead({ client, owner, repo, workflow, runs, log })) {
      continue;
    }

    cleanupPlans.push({ workflow, runs });
  }

  // Clear smaller histories first so one bounded run removes as many stale sidebar
  // workflow identities as possible.
  cleanupPlans.sort((left, right) =>
    left.runs.length - right.runs.length || left.workflow.id - right.workflow.id,
  );

  const plannedRuns = cleanupPlans.reduce((sum, plan) => sum + plan.runs.length, 0);
  log(
    `Preflight approved ${cleanupPlans.length} orphan workflow(s) containing ${plannedRuns} run(s).`,
  );

  // The active-path snapshot is valid only for the exact default-branch generation
  // that produced it. Abort before the first DELETE if main moved during preflight.
  const currentDefaultBranchGeneration = await readBranchGeneration({
    client,
    owner,
    repo,
    branch: defaultBranch,
  });
  if (currentDefaultBranchGeneration !== defaultBranchGeneration) {
    throw new Error(
      `default_branch_moved_during_cleanup:${defaultBranchGeneration}:${currentDefaultBranchGeneration}`,
    );
  }

  let deletedRuns = 0;
  let capped = false;
  const failures = [];

  outer: for (const { workflow, runs } of cleanupPlans) {
    for (const run of runs) {
      if (deletedRuns >= maxDeletions) {
        capped = true;
        break outer;
      }

      try {
        await client.request(`/repos/${owner}/${repo}/actions/runs/${run.id}`, { method: "DELETE" });
        deletedRuns += 1;
      } catch (error) {
        if (error instanceof GitHubHttpError && error.status === 404) {
          log(`Run ${run.id} for ${workflow.name} disappeared before deletion; continuing.`);
          continue;
        }
        failures.push(
          `${workflow.name} run ${run.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  if (capped) {
    log(
      `Stopped after ${maxDeletions} deletions; remaining approved runs will be handled by a later run.`,
    );
  }

  if (failures.length > 0) {
    throw new Error(`Failed to delete ${failures.length} workflow run(s):\n${failures.join("\n")}`);
  }

  const summary = {
    totalWorkflowRecords: workflows.length,
    activeWorkflowFiles: activePaths.size,
    orphanCandidates: candidates.length,
    approvedWorkflows: cleanupPlans.length,
    plannedRuns,
    deletedRuns,
    capped,
    defaultBranchGeneration,
  };
  log(`Cleanup complete: ${JSON.stringify(summary)}`);
  return summary;
}

function isEntrypoint() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isEntrypoint()) {
  await cleanupOrphanedWorkflowRuns({
    token: process.env.GITHUB_TOKEN,
    repository: process.env.GITHUB_REPOSITORY,
  });
}
