import { classifyCoveringPullRequests, normalizeCoveringPullPages } from "./covering-pr.mjs";
import { diffPrBodyMedia } from "./pr-body-media.mjs";
import { assertPublishedMarkdown } from "./published-body-integrity.mjs";

const LIFECYCLE_ACTIONS = new Set([
  "push_code",
  "create_pr",
  "update_pr_body",
  "create_issue",
  "assign_issue",
]);

function required(value, name) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`${name}_required`);
  }
  return value;
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${name}_invalid`);
  return number;
}

function exactSha(value, name, { absent = false } = {}) {
  const text = String(required(value, name)).toLowerCase();
  if (absent && text === "absent") return text;
  if (!/^[0-9a-f]{40,64}$/.test(text)) throw new Error(`${name}_invalid`);
  return text;
}

function run(runner, command) {
  const [executable, ...args] = command;
  const result = runner(executable, args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new Error(detail || `mutation_preflight_failed:${result.status}`);
  }
  return String(result.stdout || "").trim();
}

function parseJson(value, errorCode) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    throw new Error(errorCode);
  }
}

function canonicalRemoteUrl(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (/^[^@\s]+@[^:\s]+:.+/.test(text)) {
    const [, host, path] = text.match(/^[^@\s]+@([^:\s]+):(.+)$/) || [];
    if (!host || !path) return null;
    return `${host.toLowerCase()}/${path.replace(/^\/+|\.git$/g, "")}`;
  }
  try {
    const url = new URL(text);
    const path = url.pathname.replace(/^\/+|\.git$/g, "");
    return `${url.hostname.toLowerCase()}/${path}`;
  } catch {
    return null;
  }
}

function assertPushTarget(request, runner) {
  const remote = String(required(request.remote, "remote"));
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote)) throw new Error("remote_invalid");
  const branch = String(required(request.branch, "branch"));
  run(runner, ["git", "check-ref-format", `refs/heads/${branch}`]);

  const actualUrl = run(runner, ["git", "remote", "get-url", remote]);
  const repoJson = run(runner, [
    "gh",
    "repo",
    "view",
    String(required(request.repo, "repo")),
    "--json",
    "url,sshUrl",
  ]);
  const repo = parseJson(repoJson, "push_repo_identity_invalid_json");
  const actual = canonicalRemoteUrl(actualUrl);
  const allowed = new Set([canonicalRemoteUrl(repo?.url), canonicalRemoteUrl(repo?.sshUrl)].filter(Boolean));
  if (!actual || !allowed.has(actual)) {
    throw new Error(`push_remote_repo_mismatch:${actual || "unreadable"}`);
  }

  const expected = exactSha(request.expectedRemoteTip, "expected_remote_tip", { absent: true });
  const newTip = exactSha(request.newTip, "new_tip");
  const remoteRow = run(runner, ["git", "ls-remote", "--heads", remote, `refs/heads/${branch}`]);
  const observed = remoteRow ? String(remoteRow.split(/\s+/)[0] || "").toLowerCase() : "absent";
  if (observed !== expected) {
    throw new Error(`expected_remote_tip_mismatch: expected ${expected}, observed ${observed || "absent"}`);
  }
  if (request.forceWithLease !== true && expected !== "absent") {
    run(runner, ["git", "merge-base", "--is-ancestor", expected, newTip]);
  }
  return { remote, branch, expectedRemoteTip: expected, newTip };
}

function validateApprovedMediaRemovals(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("approved_media_removals_invalid");
  return value.map((entry) => {
    if (typeof entry !== "string" || !entry.trim()) throw new Error("approved_media_removal_invalid");
    return entry.trim();
  });
}

function assertUpdatePrBodySafe(request, runner) {
  const repo = String(required(request.repo, "repo"));
  const pr = positiveInteger(request.pr, "pr");
  const expectedHead = exactSha(request.expectedHead, "expected_head");
  const raw = run(runner, [
    "gh",
    "pr",
    "view",
    String(pr),
    "--repo",
    repo,
    "--json",
    "headRefOid,body",
  ]);
  const observed = parseJson(raw, "update_pr_body_preflight_invalid_json");
  const observedHead = exactSha(observed?.headRefOid, "observed_head");
  if (observedHead !== expectedHead) {
    throw new Error(`expected_head_mismatch: expected ${expectedHead}, observed ${observedHead}`);
  }

  const approvedMediaRemovals = validateApprovedMediaRemovals(request.approvedMediaRemovals);
  const media = diffPrBodyMedia(observed?.body || "", String(required(request.body, "body")), approvedMediaRemovals);
  if (media.unapprovedMissing.length > 0) {
    throw new Error(`pr_body_media_removal_unapproved:${media.unapprovedMissing.join(",")}`);
  }
  return { observedHead, media };
}

function sameRepo(left, right) {
  return String(left || "").toLowerCase() === String(right || "").toLowerCase();
}

function splitHead(repo, head) {
  const targetOwner = String(repo).split("/")[0];
  const value = String(head).trim();
  if (!value) throw new Error("head_invalid");
  const separator = value.indexOf(":");
  if (separator < 0) return { owner: targetOwner, branch: value, explicitOwner: false };
  if (value.indexOf(":", separator + 1) >= 0) throw new Error("head_invalid");
  const owner = value.slice(0, separator).trim();
  const branch = value.slice(separator + 1).trim();
  if (!owner || !branch) throw new Error("head_invalid");
  return { owner, branch, explicitOwner: true };
}

function optionalHeadRepo(request) {
  if (request.headRepo === undefined || request.headRepo === null) return null;
  const value = String(request.headRepo).trim();
  if (!value) throw new Error("head_repo_required");
  if (!/^[^/\s]+\/[^/\s]+$/.test(value)) throw new Error("head_repo_invalid");
  return value;
}

function createPrHeadIdentity(request) {
  const repo = String(required(request.repo, "repo")).trim();
  const head = splitHead(repo, required(request.head, "head"));
  const headRepo = optionalHeadRepo(request);
  if (headRepo) {
    const headRepoOwner = headRepo.split("/")[0];
    if (head.explicitOwner && headRepoOwner.toLowerCase() !== head.owner.toLowerCase()) {
      throw new Error("head_owner_repo_mismatch");
    }
    if (!head.explicitOwner && !sameRepo(headRepo, repo)) {
      throw new Error("head_repo_requires_qualified_head");
    }
  }
  return {
    ...head,
    headRepo,
    intendedHeadRepo: headRepo ?? (head.explicitOwner ? null : repo),
  };
}

function createPrCommand(request, repo) {
  const identity = createPrHeadIdentity(request);
  const base = String(required(request.base, "base"));
  const head = String(required(request.head, "head"));
  const title = String(required(request.title, "title"));
  const body = String(required(request.body, "body"));

  if (identity.headRepo) {
    const headRepoName = identity.headRepo.split("/")[1];
    const command = [
      "gh",
      "api",
      `repos/${repo}/pulls`,
      "--method",
      "POST",
      "--raw-field",
      `title=${title}`,
      "--raw-field",
      `head=${head}`,
      "--raw-field",
      `head_repo=${headRepoName}`,
      "--raw-field",
      `base=${base}`,
      "--raw-field",
      `body=${body}`,
    ];
    if (request.draft === true) command.push("--field", "draft=true");
    return command;
  }

  const command = [
    "gh",
    "pr",
    "create",
    "--repo",
    repo,
    "--base",
    base,
    "--head",
    head,
    "--title",
    title,
    "--body",
    body,
  ];
  if (request.draft === true) command.push("--draft");
  return command;
}

function assertCreatePrNotDuplicate(request, runner) {
  const repo = String(required(request.repo, "repo"));
  const base = String(required(request.base, "base"));
  const { owner, branch, intendedHeadRepo } = createPrHeadIdentity(request);
  const headLabel = `${owner}:${branch}`;
  const endpoint = `repos/${repo}/pulls?state=open&head=${encodeURIComponent(headLabel)}&per_page=100`;
  const raw = run(runner, ["gh", "api", endpoint, "--paginate", "--slurp"]);
  const payload = parseJson(raw || "[]", "create_pr_preflight_invalid_json");
  const rows = normalizeCoveringPullPages(payload, repo);
  const result = classifyCoveringPullRequests({
    intendedRepo: repo,
    intendedHeadRepo,
    intendedHead: branch,
    intendedBase: base,
    rows,
  });
  if (result.state === "reuse") {
    throw new Error(`create_pr_existing:${result.pullRequest.number}:${result.pullRequest.url}`);
  }
  if (result.state === "ambiguous") {
    throw new Error(`create_pr_ambiguous:${result.matches.map((entry) => entry.number).join(",")}`);
  }
  return result;
}

export function validateLifecycleMutation(request = {}) {
  if (!LIFECYCLE_ACTIONS.has(request.action)) return false;
  switch (request.action) {
    case "push_code":
      required(request.remote, "remote");
      required(request.branch, "branch");
      exactSha(request.expectedRemoteTip, "expected_remote_tip", { absent: true });
      exactSha(request.newTip, "new_tip");
      if (typeof request.forceWithLease !== "boolean") throw new Error("force_with_lease_required");
      break;
    case "create_pr":
      required(request.base, "base");
      createPrHeadIdentity(request);
      required(request.title, "title");
      required(request.body, "body");
      assertPublishedMarkdown(request.body);
      required(request.idempotencyKey, "idempotency_key");
      break;
    case "update_pr_body":
      positiveInteger(request.pr, "pr");
      exactSha(request.expectedHead, "expected_head");
      required(request.body, "body");
      assertPublishedMarkdown(request.body);
      validateApprovedMediaRemovals(request.approvedMediaRemovals);
      break;
    case "create_issue":
      required(request.title, "title");
      required(request.body, "body");
      assertPublishedMarkdown(request.body);
      required(request.idempotencyKey, "idempotency_key");
      break;
    case "assign_issue":
      positiveInteger(request.issue, "issue");
      required(request.assignee, "assignee");
      break;
  }
  return true;
}

export function lifecycleCommandFor(request = {}) {
  if (!LIFECYCLE_ACTIONS.has(request.action)) return null;
  const repo = String(required(request.repo, "repo"));
  switch (request.action) {
    case "push_code": {
      const branch = String(required(request.branch, "branch"));
      const expected = exactSha(request.expectedRemoteTip, "expected_remote_tip", { absent: true });
      const newTip = exactSha(request.newTip, "new_tip");
      const leaseExpectation = expected === "absent" ? "" : expected;
      return [
        "git",
        "push",
        `--force-with-lease=refs/heads/${branch}:${leaseExpectation}`,
        String(required(request.remote, "remote")),
        `${newTip}:refs/heads/${branch}`,
      ];
    }
    case "create_pr":
      return createPrCommand(request, repo);
    case "update_pr_body":
      return [
        "gh",
        "pr",
        "edit",
        String(positiveInteger(request.pr, "pr")),
        "--repo",
        repo,
        "--body",
        String(required(request.body, "body")),
      ];
    case "create_issue":
      return [
        "gh",
        "issue",
        "create",
        "--repo",
        repo,
        "--title",
        String(required(request.title, "title")),
        "--body",
        String(required(request.body, "body")),
      ];
    case "assign_issue":
      return [
        "gh",
        "issue",
        "edit",
        String(positiveInteger(request.issue, "issue")),
        "--repo",
        repo,
        "--add-assignee",
        String(required(request.assignee, "assignee")),
      ];
    default:
      return null;
  }
}

export function preflightLifecycleMutation({ request, runner }) {
  if (request.action === "push_code") return assertPushTarget(request, runner);
  if (request.action === "update_pr_body") return assertUpdatePrBodySafe(request, runner);
  if (request.action === "create_pr") return assertCreatePrNotDuplicate(request, runner);
  return null;
}

export function verifyLifecycleMutation({ request, runner }) {
  if (request.action === "push_code") {
    const remote = String(required(request.remote, "remote"));
    const branch = String(required(request.branch, "branch"));
    const expected = exactSha(request.newTip, "new_tip");
    const row = run(runner, ["git", "ls-remote", "--heads", remote, `refs/heads/${branch}`]);
    const observed = row ? String(row.split(/\s+/)[0] || "").toLowerCase() : "absent";
    if (observed !== expected) {
      throw new Error(`push_verification_failed: expected ${expected}, observed ${observed}`);
    }
    return observed;
  }
  if (request.action === "update_pr_body") {
    const observed = run(runner, [
      "gh",
      "pr",
      "view",
      String(positiveInteger(request.pr, "pr")),
      "--repo",
      String(required(request.repo, "repo")),
      "--json",
      "body",
      "--jq",
      ".body",
    ]);
    if (observed !== String(required(request.body, "body"))) {
      throw new Error("update_pr_body_verification_failed");
    }
    assertPublishedMarkdown(observed, { expected: String(request.body) });
    return observed;
  }
  if (request.action === "create_pr") {
    const observed = run(runner, [
      "gh",
      "pr",
      "view",
      String(required(request.head, "head")),
      "--repo",
      String(required(request.repo, "repo")),
      "--json",
      "body",
      "--jq",
      ".body",
    ]);
    assertPublishedMarkdown(observed);
    return observed;
  }
  if (request.action === "create_issue") {
    assertPublishedMarkdown(String(required(request.body, "body")));
    return true;
  }
  if (request.action === "assign_issue") {
    const output = run(runner, [
      "gh",
      "issue",
      "view",
      String(positiveInteger(request.issue, "issue")),
      "--repo",
      String(required(request.repo, "repo")),
      "--json",
      "assignees",
    ]);
    const payload = parseJson(output || "{}", "assign_issue_verification_invalid_json");
    const expected = String(required(request.assignee, "assignee")).toLowerCase();
    const assigned = (payload.assignees || []).some(
      (entry) => String(entry?.login || "").toLowerCase() === expected,
    );
    if (!assigned) throw new Error(`assign_issue_verification_failed:${expected}`);
    return output;
  }
  return null;
}
