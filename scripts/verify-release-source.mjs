#!/usr/bin/env node
import { validateReleaseSourceComparison } from "./lib/release-contract.mjs";

const usage =
  "Usage: node scripts/verify-release-source.mjs OWNER/REPO SOURCE_SHA DEFAULT_BRANCH";

function parseArgs(argv) {
  const [repo, sourceCommit, branch] = argv;
  if (argv.length !== 3 || !repo?.includes("/") || !sourceCommit || !branch) {
    throw new Error(usage);
  }
  return { repo, sourceCommit, branch };
}

async function fetchComparison({ repo, sourceCommit, branch, token, fetchImpl = fetch }) {
  if (!token) throw new Error("release source verification requires GH_TOKEN or GITHUB_TOKEN");
  const [owner, name] = repo.split("/");
  if (!owner || !name || repo.split("/").length !== 2) throw new Error("release repository is invalid");

  const endpoint = new URL(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/compare/${sourceCommit}...${encodeURIComponent(branch)}`,
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetchImpl(endpoint, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "github-delivery-release-source-verifier",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = String(await response.text()).slice(0, 2000).trim();
      throw new Error(
        `release source comparison failed: HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
      );
    }
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyReleaseSource({ repo, sourceCommit, branch, token, fetchImpl } = {}) {
  const comparison = await fetchComparison({
    repo,
    sourceCommit,
    branch,
    token,
    fetchImpl,
  });
  return validateReleaseSourceComparison({ sourceCommit, branch, comparison });
}

try {
  const args = parseArgs(process.argv.slice(2));
  const result = await verifyReleaseSource({
    ...args,
    token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
  });
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    kind: "github-delivery/release-source-verification",
    ...result,
  }, null, 2)}\n`);
} catch (error) {
  console.error(String(error?.message || error));
  process.exitCode = 1;
}
