#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { buildRuntimeCapabilities } from "./lib/runtime-capabilities.mjs";
import { readActivationReceipt } from "./lib/watchdog-activation.mjs";
import { ownedHelperEffect } from "./lib/watchdog-evidence-registry.mjs";

const usage =
  "Usage: node scripts/runtime-capabilities.mjs [--repo OWNER/REPO] [--input FILE]";

function parseBoolean(value) {
  if (value === undefined) return false;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function watchdogDeclaration(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const normalized = String(value).toLowerCase();
  return ["hooks", "stream", "none"].includes(normalized) ? normalized : "none";
}

function commandAvailable(command, args = ["--version"]) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return result.status === 0;
}

function ghJson(args) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout || "null");
  } catch {
    return null;
  }
}

function detectRepo(repo) {
  if (repo) return repo;
  const ghDetected = ghJson(["repo", "view", "--json", "nameWithOwner"]);
  if (ghDetected?.nameWithOwner) return ghDetected.nameWithOwner;
  const gitUrl = spawnSync(
    "git",
    ["config", "--get", "remote.origin.url"],
    { encoding: "utf8" },
  );
  const url = String(gitUrl.stdout || "").trim();
  const match = url.match(
    /(?:https?:\/\/|git@)?(?:[^/\s]+@)?github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i,
  );
  return match ? `${match[1]}/${match[2]}` : null;
}

function liveInput(repo) {
  const gh = commandAvailable("gh");
  const ghAuthenticated =
    gh && spawnSync("gh", ["auth", "status"], { encoding: "utf8" }).status === 0;
  const resolvedRepo = ghAuthenticated ? detectRepo(repo) : repo || null;
  const repoData =
    resolvedRepo && ghAuthenticated
      ? ghJson([
          "repo",
          "view",
          resolvedRepo,
          "--json",
          "nameWithOwner,viewerPermission",
        ])
      : null;
  const permission = String(repoData?.viewerPermission || "").toUpperCase();
  const codexHome = resolve(process.env.CODEX_HOME || join(homedir(), ".codex"));
  return {
    host: process.env.SHIPPING_GITHUB_HOST || "unknown",
    os: process.platform,
    repo: resolvedRepo,
    activation: readActivationReceipt({ codexHome }),
    probes: {
      node: true,
      git: commandAvailable("git"),
      gh,
      ghAuthenticated,
      repoReadableViaGh: Boolean(repoData),
      headWritableViaGh: ["ADMIN", "MAINTAIN", "WRITE"].includes(permission),
      rulesetsReadableViaGh: repoData ? true : false,
      reviewThreadsReadableViaGh: repoData ? true : false,
    },
    declarations: {
      connectorRead: parseBoolean(process.env.SHIPPING_GITHUB_CONNECTOR_READ),
      connectorWrite: parseBoolean(process.env.SHIPPING_GITHUB_CONNECTOR_WRITE),
      brokeredConnectorWrite: parseBoolean(
        process.env.SHIPPING_GITHUB_BROKERED_CONNECTOR_WRITE,
      ),
      composio: parseBoolean(process.env.SHIPPING_GITHUB_COMPOSIO),
      bugbot: parseBoolean(process.env.SHIPPING_GITHUB_BUGBOT),
      subagents: parseBoolean(process.env.SHIPPING_GITHUB_SUBAGENTS),
      reviewTool: parseBoolean(process.env.SHIPPING_GITHUB_REVIEW_TOOL),
      progressWatchdog: watchdogDeclaration(
        process.env.SHIPPING_GITHUB_PROGRESS_WATCHDOG,
      ),
      rulesetsReadable: parseBoolean(
        process.env.SHIPPING_GITHUB_CONNECTOR_RULESETS,
      ),
      reviewThreadsReadable: parseBoolean(
        process.env.SHIPPING_GITHUB_CONNECTOR_REVIEW_THREADS,
      ),
    },
  };
}

function parseArgs(argv) {
  let repo = null;
  let input = null;
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === "--repo") {
      repo = argv[++index];
      if (!repo) throw new Error("--repo requires OWNER/REPO");
    } else if (value === "--input") {
      input = argv[++index];
      if (!input) throw new Error("--input requires a file path");
    } else {
      throw new Error(`Unknown option: ${value}\n${usage}`);
    }
  }
  return { repo, input };
}

try {
  const args = parseArgs(process.argv.slice(2));
  const input = args.input
    ? JSON.parse(readFileSync(args.input, "utf8"))
    : liveInput(args.repo);
  const output = buildRuntimeCapabilities({ ...input, repo: input.repo ?? args.repo });
  output.gdEffect = {
    ...ownedHelperEffect("runtime-capabilities.mjs"),
    key: `runtime-capabilities:${output.repo || "current"}`,
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!output.readyForReadOnly) process.exitCode = 2;
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
