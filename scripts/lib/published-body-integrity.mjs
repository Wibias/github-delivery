const BACKSLASH = String.fromCharCode(92);
const LITERAL_N = BACKSLASH + "n";
const LITERAL_R = BACKSLASH + "r";
const LITERAL_T = BACKSLASH + "t";
const ESCAPED_CRLF = LITERAL_R + LITERAL_N;

function asText(value) {
  return value == null ? "" : String(value);
}

function hasLiteralEscapeSequences(body) {
  return body.includes(LITERAL_N) || body.includes(LITERAL_R) || body.includes(LITERAL_T);
}

export function inspectPublishedMarkdown(text, { expected } = {}) {
  const body = asText(text);
  const findings = [];
  if (typeof expected === "string" && expected.length > 0 && body !== expected) {
    findings.push("published_body_does_not_match_intended");
  }
  if (hasLiteralEscapeSequences(body)) findings.push("literal_escape_sequences");
  if (body.includes("## ") && body.includes(" - ") && !body.includes("\n")) {
    const collapsed = /##\s+[A-Za-z][\s\S]{0,80}? - /.test(body) && !body.includes("\n## ");
    if (collapsed && body.split("\n").length < 3) findings.push("collapsed_markdown_headings");
  }
  if (body.includes(LITERAL_N + "## ") || body.includes(LITERAL_N + "- ")) {
    findings.push("literal_newline_escapes");
  }
  if (body.includes(LITERAL_N + "[") && body.includes("]")) {
    findings.push("escaped_checklist_newlines");
  }
  return { ok: findings.length === 0, findings };
}

export function assertPublishedMarkdown(text, options = {}) {
  const inspection = inspectPublishedMarkdown(text, options);
  if (!inspection.ok) {
    throw new Error("published_markdown_malformed:" + inspection.findings.join(","));
  }
  return inspection;
}

export function repairLiteralEscapes(text) {
  return asText(text)
    .replaceAll(ESCAPED_CRLF, "\n")
    .replaceAll(LITERAL_N, "\n")
    .replaceAll(LITERAL_T, "\t");
}

export function extractTransportedBody(command, args = [], options = {}) {
  if (command !== "gh" || !Array.isArray(args)) return null;
  const bodyIndex = args.indexOf("--body");
  if (bodyIndex >= 0 && args[bodyIndex + 1] !== undefined) return String(args[bodyIndex + 1]);
  const bodyFileIndex = args.indexOf("--body-file");
  if (bodyFileIndex >= 0 && options && typeof options.input === "string") return options.input;
  const inputIndex = args.indexOf("--input");
  if (inputIndex >= 0 && options && typeof options.input === "string") {
    try {
      const parsed = JSON.parse(options.input);
      if (parsed && typeof parsed.body === "string") return parsed.body;
    } catch {
      return options.input;
    }
  }
  for (let index = 0; index < args.length - 1; index += 1) {
    const flag = args[index];
    if (flag !== "-f" && flag !== "--raw-field" && flag !== "-F" && flag !== "--field") continue;
    const value = String(args[index + 1] ?? "");
    if (value.startsWith("body=")) return value.slice("body=".length);
  }
  return null;
}

