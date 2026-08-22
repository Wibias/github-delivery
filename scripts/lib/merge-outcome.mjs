import { graphqlCliField } from "./graphql-cli-fields.mjs";

function required(value, name) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`${name}_required`);
  }
  return value;
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${name}_invalid`);
  }
  return number;
}

function repoParts(repo) {
  const parts = String(repo || "").split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("repo_invalid");
  }
  return { owner: parts[0], name: parts[1] };
}

function runOrThrow(runner, command) {
  const [executable, ...args] = command;
  const result = runner(executable, args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new Error(detail || `merge_state_command_failed:${result.status}`);
  }
  return String(result.stdout || "").trim();
}

function parseJson(output) {
  try {
    const value = JSON.parse(output);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("not_object");
    }
    return value;
  } catch {
    throw new Error("merge_state_evidence_invalid");
  }
}

export function classifyMergeOutcome(evidence) {
  if (!evidence) return null;
  if (evidence.mergedAt || String(evidence.state || "").toUpperCase() === "MERGED") {
    return "merged";
  }
  if (evidence.isInMergeQueue === true || evidence.mergeQueueEntry) {
    return "queued";
  }
  if (evidence.autoMergeRequest) {
    return "auto_merge_enabled";
  }
  return null;
}

export function readMergeState({ request, runner }) {
  if (request?.action !== "merge_pr") return null;
  if (typeof runner !== "function") throw new Error("merge_state_runner_required");
  const repo = required(request.repo, "repo");
  const { owner, name } = repoParts(repo);
  const pr = positiveInteger(request.pr, "pr");
  const expectedHead = String(required(request.expectedHead, "expected_head")).toLowerCase();
  const query = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){state mergedAt headRefOid isInMergeQueue mergeQueueEntry{state} autoMergeRequest{enabledAt mergeMethod}}}}`;
  const payload = parseJson(
    runOrThrow(runner, [
      "gh",
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-F",
      `owner=${graphqlCliField(owner, "owner")}`,
      "-F",
      `name=${graphqlCliField(name, "name")}`,
      "-F",
      `number=${pr}`,
    ]),
  );
  if (payload.errors?.length) {
    throw new Error(`merge_state_evidence_error:${JSON.stringify(payload.errors)}`);
  }
  const state = payload.data?.repository?.pullRequest;
  if (!state) throw new Error("merge_state_target_missing");
  const observedHead = String(required(state.headRefOid, "merge_state_head")).toLowerCase();
  if (observedHead !== expectedHead) {
    throw new Error(
      `merge_state_head_mismatch: expected ${expectedHead}, observed ${observedHead}`,
    );
  }
  return {
    state: String(state.state || "").toUpperCase() || null,
    mergedAt: state.mergedAt || null,
    headRefOid: observedHead,
    isInMergeQueue: state.isInMergeQueue === true,
    mergeQueueEntry: state.mergeQueueEntry || null,
    autoMergeRequest: state.autoMergeRequest || null,
  };
}
