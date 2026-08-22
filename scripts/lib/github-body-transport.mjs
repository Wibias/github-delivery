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

function parseApiField(value) {
  const text = String(value ?? "");
  const separator = text.indexOf("=");
  if (separator < 1) throw new Error("github_body_transport_malformed_api_field");
  return { key: text.slice(0, separator), value: text.slice(separator + 1) };
}

function typedFieldValue(flag, value) {
  if (flag === "-F" || flag === "--field") {
    if (String(value).startsWith("@")) throw new Error("github_body_transport_field_at_file");
    return JSON.parse(value);
  }
  return value;
}

function apiBodyTransport(args, options) {
  if (args[0] !== "api") return null;
  const fields = [];
  for (let index = 0; index < args.length - 1; index += 1) {
    if (!API_FIELD_FLAGS.has(args[index])) continue;
    fields.push({ index, flag: args[index], value: String(args[index + 1] ?? "") });
    index += 1;
  }
  const parsedFields = fields.map((field) => ({ ...field, ...parseApiField(field.value) }));
  const bodyFields = parsedFields.filter((field) => field.key === "body");
  if (!bodyFields.length) return null;
  if (bodyFields.length !== 1) {
    throw new Error("github_body_transport_ambiguous_api_fields");
  }

  const payload = {};
  const skip = new Set();
  for (const field of parsedFields) {
    payload[field.key] = typedFieldValue(field.flag, field.value);
    skip.add(field.index);
    skip.add(field.index + 1);
  }

  const nextArgs = args.filter((_, index) => !skip.has(index));
  nextArgs.push("--input", "-");
  return {
    args: nextArgs,
    options: {
      ...options,
      input: JSON.stringify(payload),
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
