#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  actionsPolicyQuery,
  actionsSnapshotRepairPlan,
  latestOpinionatedReviewsFromRest,
  repairActionsSnapshot,
} from "./lib/actions-snapshot-repair.mjs";

const CORE_SNAPSHOT_COMMAND = fileURLToPath(
  new URL("./ship-gate-snapshot.mjs", import.meta.url),
);

function parseArgs(argv) {
  const positionals = [];
  let output = null;
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === "--output") {
      output = argv[++index];
      if (!output) throw new Error("--output requires a file path");
    } else if (value.startsWith("--")) {
      throw new Error(`Unknown option: ${value}`);
    } else {
      positionals.push(value);
    }
  }
  const [repo, prRaw] = positionals;
  const pr = Number(prRaw);
  if (
    positionals.length !== 2 ||
    !repo?.includes("/") ||
    !Number.isInteger(pr) ||
    pr <= 0
  ) {
    throw new Error(
      "Usage: node scripts/actions-ship-gate-snapshot.mjs OWNER/REPO PR_NUMBER [--output FILE]",
    );
  }
  return { repo, pr, output };
}

function run(command, args) {
  return spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 100 * 1024 * 1024,
  });
}

function ghOk(args) {
  const result = run("gh", args);
  return {
    ok: result.status === 0,
    body: String(result.stdout || ""),
    error: String(result.stderr || result.stdout || "").trim() || null,
  };
}

function isNotFound(error) {
  return /(?:HTTP\s+404|Not Found|Branch not protected)/i.test(
    String(error || ""),
  );
}

function parseJson(body, context) {
  try {
    return JSON.parse(body || "null");
  } catch {
    throw new Error(`${context} returned invalid JSON`);
  }
}

function fetchMergeQueuePolicy(owner, name, pr) {
  const response = ghOk([
    "api",
    "graphql",
    "-f",
    `query=${actionsPolicyQuery()}`,
    "-F",
    `owner=${owner}`,
    "-F",
    `name=${name}`,
    "-F",
    `number=${pr}`,
  ]);
  if (!response.ok) {
    throw new Error(response.error || "Actions merge-queue GraphQL request failed");
  }
  const payload = parseJson(response.body, "Actions merge-queue GraphQL");
  if (payload.errors?.length) {
    throw new Error(
      `Actions merge-queue GraphQL failed: ${JSON.stringify(payload.errors)}`,
    );
  }
  const pullRequest = payload.data?.repository?.pullRequest;
  if (!pullRequest) {
    throw new Error("Actions merge-queue GraphQL returned an unexpected payload");
  }
  return {
    enabled: pullRequest.isMergeQueueEnabled === true,
    inQueue: pullRequest.isInMergeQueue === true,
    entry: pullRequest.mergeQueueEntry || null,
  };
}

function fetchBranchProtection(owner, name, base) {
  const response = ghOk([
    "api",
    `repos/${owner}/${name}/branches/${encodeURIComponent(base)}/protection`,
  ]);
  if (response.ok) {
    return parseJson(response.body, "branch protection");
  }
  if (isNotFound(response.error)) return null;
  throw new Error(response.error || "branch protection request failed");
}

function writeSnapshot(snapshot, output) {
  const json = `${JSON.stringify(snapshot, null, 2)}\n`;
  if (output) writeFileSync(output, json, "utf8");
  process.stdout.write(json);
}

try {
  const { repo, pr, output } = parseArgs(process.argv.slice(2));
  const core = run(process.execPath, [CORE_SNAPSHOT_COMMAND, repo, String(pr)]);
  const snapshot = parseJson(core.stdout, "core snapshot command");

  if (core.status === 0) {
    writeSnapshot(snapshot, output);
    process.exitCode = 0;
  } else if (core.status === 2) {
    const plan = actionsSnapshotRepairPlan(snapshot);
    if (!plan.repairable) {
      writeSnapshot(snapshot, output);
      process.exitCode = 2;
    } else {
      const [owner, name] = repo.split("/");
      const policy = plan.repairPolicy
        ? {
            latestOpinionatedReviews: latestOpinionatedReviewsFromRest(
              snapshot.evidence?.feedback?.reviews || [],
            ),
            mergeQueue: fetchMergeQueuePolicy(owner, name, pr),
          }
        : null;
      const branchProtection = plan.repairPolicy
        ? fetchBranchProtection(
            owner,
            name,
            snapshot.evidence?.pullRequest?.baseRefName,
          )
        : undefined;
      const repaired = repairActionsSnapshot({
        snapshot,
        policy,
        branchProtection,
        actor: plan.repairViewer ? plan.actor : null,
      });
      writeSnapshot(repaired, output);
      process.exitCode = repaired.complete ? 0 : 2;
    }
  } else {
    throw new Error(
      String(core.stderr || core.stdout || "core snapshot command failed").trim(),
    );
  }
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
