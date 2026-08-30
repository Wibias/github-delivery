import { createHash } from "node:crypto";

import { boundedSpawnSync } from "./subprocess-policy.mjs";

function run(command, args, { trim = true } = {}) {
  const result = boundedSpawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || `${command} failed`).trim());
  }
  const output = String(result.stdout || "");
  return trim ? output.trim() : output;
}

function maybe(command, args) {
  const result = boundedSpawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result.status !== 0) return null;
  return String(result.stdout || "").trim();
}

export function parseNullDelimitedNameStatus(output) {
  const fields = String(output || "").split("\0");
  if (fields.at(-1) === "") fields.pop();
  else if (fields.length > 1 || fields[0]) throw new Error("branch_diff_name_status_not_nul_terminated");

  const rows = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (!status) throw new Error("branch_diff_status_missing");
    const kind = status[0];
    if (kind === "R" || kind === "C") {
      const previousPath = fields[index++];
      const path = fields[index++];
      if (previousPath === undefined || path === undefined) {
        throw new Error("branch_diff_rename_record_incomplete");
      }
      rows.push({ status, previousPath, path });
      continue;
    }
    const path = fields[index++];
    if (path === undefined) throw new Error("branch_diff_path_missing");
    rows.push({ status, previousPath: null, path });
  }
  return rows;
}

function resolveRepoForBranch() {
  try {
    const name = JSON.parse(run("gh", ["repo", "view", "--json", "nameWithOwner"])).nameWithOwner;
    if (typeof name === "string" && name.includes("/")) return name;
  } catch {
    // Fall through to the configured git remote.
  }
  const remote = maybe("git", ["remote", "get-url", "origin"]);
  if (!remote) return null;
  const match = String(remote).match(/(?:[:/])([^/:]+)\/([^/]+?)(?:\.git)?$/);
  return match ? `${match[1]}/${match[2]}` : null;
}

function patchForRecord(baseRef, headRef, record) {
  const paths = record.previousPath
    ? [record.previousPath, record.path]
    : [record.path];
  return run(
    "git",
    [
      "diff",
      "--no-ext-diff",
      "--unified=3",
      `${baseRef}...${headRef}`,
      "--",
      ...paths,
    ],
    { trim: false },
  );
}

function diffIdentity({ baseRefOid, headRefOid, files }) {
  const digest = createHash("sha256");
  digest.update(String(baseRefOid || ""));
  digest.update("\0");
  digest.update(String(headRefOid || ""));
  for (const file of files) {
    digest.update("\0");
    digest.update(String(file.status || ""));
    digest.update("\0");
    digest.update(String(file.previousPath || ""));
    digest.update("\0");
    digest.update(String(file.path || ""));
    digest.update("\0");
    digest.update(String(file.patch || ""));
  }
  return `sha256:${digest.digest("hex")}`;
}

export function collectBranchReviewInput(baseRef, headRef) {
  const nameStatus = run(
    "git",
    ["diff", "--name-status", "-z", `${baseRef}...${headRef}`],
    { trim: false },
  );
  const records = parseNullDelimitedNameStatus(nameStatus);
  const files = records.map((record) => {
    const patch = patchForRecord(baseRef, headRef, record);
    const additions = patch
      .split(/\r?\n/)
      .filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
    const deletions = patch
      .split(/\r?\n/)
      .filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
    return {
      path: record.path,
      previousPath: record.previousPath,
      status: record.status,
      patch,
      additions,
      deletions,
    };
  });
  const baseRefOid = maybe("git", ["rev-parse", "--verify", baseRef]) || null;
  const headRefOid = maybe("git", ["rev-parse", "--verify", headRef]) || null;
  return {
    repo: resolveRepoForBranch(),
    pr: null,
    baseRefOid,
    headRefOid,
    diffIdentity: diffIdentity({ baseRefOid, headRefOid, files }),
    files,
  };
}
