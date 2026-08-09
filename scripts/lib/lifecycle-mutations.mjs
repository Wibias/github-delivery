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
  let repo;
  try {
    repo = JSON.parse(repoJson);
  } catch {
    throw new Error("push_repo_identity_invalid_json");
  }
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
      required(request.head, "head");
      required(request.title, "title");
      required(request.body, "body");
      required(request.idempotencyKey, "idempotency_key");
      break;
    case "update_pr_body":
      positiveInteger(request.pr, "pr");
      required(request.expectedHead, "expected_head");
      required(request.body, "body");
      break;
    case "create_issue":
      required(request.title, "title");
      required(request.body, "body");
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
    case "create_pr": {
      const command = [
        "gh",
        "pr",
        "create",
        "--repo",
        repo,
        "--base",
        String(required(request.base, "base")),
        "--head",
        String(required(request.head, "head")),
        "--title",
        String(required(request.title, "title")),
        "--body",
        String(required(request.body, "body")),
      ];
      if (request.draft === true) command.push("--draft");
      return command;
    }
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
    return observed;
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
    let payload;
    try {
      payload = JSON.parse(output || "{}");
    } catch {
      throw new Error("assign_issue_verification_invalid_json");
    }
    const expected = String(required(request.assignee, "assignee")).toLowerCase();
    const assigned = (payload.assignees || []).some(
      (entry) => String(entry?.login || "").toLowerCase() === expected,
    );
    if (!assigned) throw new Error(`assign_issue_verification_failed:${expected}`);
    return output;
  }
  return null;
}
