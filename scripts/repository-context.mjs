#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

function run(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 20 * 1024 * 1024,
    }).trim();
  } catch (error) {
    const stderr = error.stderr?.toString?.().trim();
    throw new Error(
      `repository_context_command_failed:${command}${stderr ? `:${stderr}` : ""}`,
    );
  }
}

function parseJson(value, code) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(code);
  }
}

function normalizeRepositoryParts(owner, repo) {
  const cleanOwner = String(owner || "").trim();
  const cleanRepo = String(repo || "").trim().replace(/\.git$/i, "");
  const valid = /^[A-Za-z0-9_.-]+$/;
  if (!valid.test(cleanOwner) || !valid.test(cleanRepo)) {
    throw new Error("repository_specifier_invalid");
  }
  return `${cleanOwner}/${cleanRepo}`;
}

export function parseRepositorySpecifier(input) {
  const value = String(input || "").trim();
  if (!value) throw new Error("repository_specifier_missing");

  if (!value.includes("://")) {
    const parts = value.split("/").filter(Boolean);
    if (parts.length !== 2) throw new Error("repository_specifier_invalid");
    return normalizeRepositoryParts(parts[0], parts[1]);
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("repository_specifier_invalid_url");
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") {
    throw new Error("repository_specifier_unsupported_host");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error("repository_specifier_invalid");
  return normalizeRepositoryParts(parts[0], parts[1]);
}

export function resolveRepositorySnapshot(input, runner = run, requestedRef = null) {
  const requestedRepo = parseRepositorySpecifier(input);
  const metadata = parseJson(
    runner("gh", [
      "repo",
      "view",
      requestedRepo,
      "--json",
      "nameWithOwner,defaultBranchRef,url",
    ]),
    "repository_metadata_invalid_json",
  );

  const repo = metadata?.nameWithOwner;
  const defaultBranch = metadata?.defaultBranchRef?.name;
  const url = metadata?.url;
  if (!repo) throw new Error("repository_identity_missing");
  if (!defaultBranch) throw new Error("repository_default_branch_missing");
  if (!url) throw new Error("repository_url_missing");

  const branch = requestedRef ? String(requestedRef).trim() : String(defaultBranch);
  if (!branch) throw new Error("repository_snapshot_ref_missing");

  const commit = parseJson(
    runner("gh", [
      "api",
      `repos/${repo}/commits/${encodeURIComponent(branch)}`,
    ]),
    "repository_snapshot_invalid_json",
  );
  const sha = commit?.sha;
  if (!sha || !/^[0-9a-f]{40,64}$/i.test(String(sha))) {
    throw new Error("repository_snapshot_sha_missing");
  }

  return {
    repo: String(repo),
    defaultBranch: String(defaultBranch),
    branch,
    sha: String(sha),
    url: String(url),
  };
}

function encodeRepositoryPath(path) {
  const value = String(path || "").trim().replace(/^\/+/, "");
  if (!value || value.includes("\0")) throw new Error("repository_path_invalid");
  return value.split("/").map(encodeURIComponent).join("/");
}

export function readRepositoryFile(snapshot, path, runner = run) {
  const repo = parseRepositorySpecifier(snapshot?.repo);
  const sha = String(snapshot?.sha || "");
  if (!/^[0-9a-f]{40,64}$/i.test(sha)) {
    throw new Error("repository_snapshot_sha_missing");
  }
  const encodedPath = encodeRepositoryPath(path);
  return runner("gh", [
    "api",
    `repos/${repo}/contents/${encodedPath}?ref=${sha}`,
    "-H",
    "Accept: application/vnd.github.raw+json",
  ]);
}

function parseArgs(argv) {
  const out = { input: null, paths: [], ref: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--ref") {
      const ref = argv[++i];
      if (!ref) throw new Error("repository_snapshot_ref_missing");
      out.ref = ref;
    } else if (arg === "--path") {
      const path = argv[++i];
      if (!path) throw new Error("repository_path_missing");
      out.paths.push(path);
    } else if (arg === "--help" || arg === "-h") {
      out.help = true;
    } else if (!out.input) {
      out.input = arg;
    } else {
      throw new Error(`repository_context_unknown_arg:${arg}`);
    }
  }
  return out;
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(
      "Usage: node scripts/repository-context.mjs <owner/repo|github-url> [--ref <branch>] [--path <path>]...",
    );
    return 0;
  }
  if (!args.input) throw new Error("repository_specifier_missing");

  const snapshot = resolveRepositorySnapshot(args.input, run, args.ref);
  const files = args.paths.map((path) => ({
    path,
    content: readRepositoryFile(snapshot, path),
  }));
  console.log(JSON.stringify({ ...snapshot, files }, null, 2));
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(String(error?.message || error));
    process.exitCode = 2;
  }
}
