import { assertPublishedMarkdown, extractTransportedBody } from "./published-body-integrity.mjs";

const BODY_FLAG = "--body";
const BODY_FILE_FLAG = "--body-file";
const API_FIELD_FLAGS = new Set(["-f", "--raw-field", "-F", "--field"]);

function bodyFlagTransport(args, options) {
  const index = args.indexOf(BODY_FLAG);
  if (index < 0) return null;
  const body = args[index + 1];
  if (body === undefined) throw new Error("github_body_argument_missing");
  const nextArgs = [...args];
  nextArgs.splice(index, 2, BODY_FILE_FLAG, "-");
  return {
    args: nextArgs,
    options: { ...options, input: String(body) },
    kind: "body_file_stdin",
  };
}

function apiBodyTransport(args, options) {
  if (args[0] !== "api") return null;
  const fields = [];
  for (let index = 0; index < args.length - 1; index += 1) {
    if (!API_FIELD_FLAGS.has(args[index])) continue;
    fields.push({ index, flag: args[index], value: String(args[index + 1] ?? "") });
    index += 1;
  }
  const bodyFields = fields.filter((field) => field.value.startsWith("body="));
  if (!bodyFields.length) return null;
  if (bodyFields.length !== 1 || fields.length !== 1) {
    throw new Error("github_body_transport_ambiguous_api_fields");
  }

  const field = bodyFields[0];
  const body = field.value.slice("body=".length);
  const nextArgs = [...args];
  nextArgs.splice(field.index, 2);
  nextArgs.push("--input", "-");
  return {
    args: nextArgs,
    options: {
      ...options,
      input: JSON.stringify({ body }),
    },
    kind: "api_json_stdin",
  };
}

export function transportGitHubBody(command, args = [], options = {}) {
  if (command !== "gh" || !Array.isArray(args)) {
    return { command, args, options, kind: null };
  }
  const bodyFile = bodyFlagTransport(args, options);
  if (bodyFile) return { command, ...bodyFile };
  const apiBody = apiBodyTransport(args, options);
  if (apiBody) return { command, ...apiBody };
  return { command, args, options, kind: null };
}

export function makeGitHubBodyTransportRunner(runner) {
  if (typeof runner !== "function") throw new Error("github_body_transport_runner_required");
  return function githubBodyTransportRunner(command, args, options) {
    const transported = transportGitHubBody(command, args, options);
    const body = extractTransportedBody(transported.command, transported.args, transported.options);
    if (body !== null) assertPublishedMarkdown(body);
    return runner(transported.command, transported.args, transported.options);
  };
}
