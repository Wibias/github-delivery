const UNTRUSTED_RUN_EXPRESSION_RE = /\$\{\{\s*(github\.(?:head_ref|event\.(?:pull_request\.(?:title|body|head\.ref|head\.label)|issue\.(?:title|body)|comment\.body|review\.body|review_comment\.body|head_commit\.message|workflow_run\.head_branch)))\b[^}]*\}\}/gi;

function stripComment(line) {
  let single = false;
  let double = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "'" && !double) {
      if (single && line[index + 1] === "'") {
        index += 1;
        continue;
      }
      single = !single;
      continue;
    }
    if (char === '"' && !single && line[index - 1] !== "\\") {
      double = !double;
      continue;
    }
    if (char === "#" && !single && !double && (index === 0 || /\s/.test(line[index - 1]))) {
      return line.slice(0, index).trimEnd();
    }
  }
  return line.trimEnd();
}

function splitMapping(text) {
  let single = false;
  let double = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "'" && !double) {
      if (single && text[index + 1] === "'") {
        index += 1;
        continue;
      }
      single = !single;
      continue;
    }
    if (char === '"' && !single && text[index - 1] !== "\\") {
      double = !double;
      continue;
    }
    if (char === ":" && !single && !double) {
      const next = text[index + 1];
      if (next === undefined || /\s/.test(next)) {
        return [text.slice(0, index), text.slice(index + 1)];
      }
    }
  }
  return null;
}

function decodeScalar(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (text.startsWith('"') && text.endsWith('"')) {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("yaml_quoted_scalar_invalid");
    }
  }
  return text;
}

function runCommandLines(source) {
  const lines = String(source).replace(/\r\n?/g, "\n").split("\n");
  const commands = [];
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const match = raw.match(/^(\s*)(?:-\s+)?(?:["']?run["']?)\s*:\s*(.*)$/);
    if (!match) continue;
    const indent = match[1].length;
    const value = match[2];
    if (/^[|>][+-]?\s*(?:#.*)?$/.test(value.trim())) {
      for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
        const candidate = lines[cursor];
        if (!candidate.trim()) {
          commands.push({ line: cursor + 1, text: candidate });
          continue;
        }
        const candidateIndent = candidate.length - candidate.trimStart().length;
        if (candidateIndent <= indent) break;
        commands.push({ line: cursor + 1, text: candidate });
      }
    } else {
      commands.push({ line: index + 1, text: value });
    }
  }
  return commands;
}

function untrustedRunExpressionErrors(source) {
  const errors = [];
  for (const command of runCommandLines(source)) {
    UNTRUSTED_RUN_EXPRESSION_RE.lastIndex = 0;
    for (const match of command.text.matchAll(UNTRUSTED_RUN_EXPRESSION_RE)) {
      errors.push({
        code: "yaml_untrusted_run_expression",
        line: command.line,
        expression: match[1],
      });
    }
  }
  return errors;
}

export function parseWorkflowSecurityYaml(source = "") {
  source = String(source).replace(/\r\n?/g, "\n");
  const records = [];
  const errors = [...untrustedRunExpressionErrors(source)];
  const lines = source.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const lineNumber = index + 1;
    if (/^\s*\t|\t/.test(raw)) {
      errors.push({ code: "yaml_tabs_unsupported", line: lineNumber });
      continue;
    }
    const uncommented = stripComment(raw);
    if (!uncommented.trim()) continue;
    const trimmed = uncommented.trim();
    if (["---", "..."].includes(trimmed)) {
      errors.push({ code: "yaml_multidoc_unsupported", line: lineNumber });
      continue;
    }
    if (/^[?]/.test(trimmed)) {
      errors.push({ code: "yaml_complex_key_unsupported", line: lineNumber });
      continue;
    }
    if (/(^|\s)<<\s*:/.test(trimmed)) {
      errors.push({ code: "yaml_merge_key_unsupported", line: lineNumber });
      continue;
    }

    const indent = raw.length - raw.trimStart().length;
    let body = uncommented.slice(indent);
    let sequence = false;
    if (body.startsWith("- ")) {
      sequence = true;
      body = body.slice(2);
    } else if (body === "-") {
      records.push({ line: lineNumber, indent, sequence: true, key: null, value: "" });
      continue;
    }

    const mapping = splitMapping(body);
    if (!mapping) continue;
    let key;
    let value;
    try {
      key = decodeScalar(mapping[0]);
      value = decodeScalar(mapping[1]);
    } catch {
      errors.push({ code: "yaml_scalar_invalid", line: lineNumber });
      continue;
    }
    if (!key) {
      errors.push({ code: "yaml_empty_key", line: lineNumber });
      continue;
    }
    if (key === "<<") {
      errors.push({ code: "yaml_merge_key_unsupported", line: lineNumber });
      continue;
    }
    if (["permissions", "on", "uses"].includes(key) && /[&*]/.test(value)) {
      errors.push({ code: "yaml_security_alias_unsupported", line: lineNumber });
    }
    records.push({ line: lineNumber, indent, sequence, key, value });
  }

  return { records, errors };
}

function descendants(records, index) {
  const parent = records[index];
  const rows = [];
  for (let cursor = index + 1; cursor < records.length; cursor += 1) {
    const row = records[cursor];
    if (row.indent <= parent.indent) break;
    rows.push(row);
  }
  return rows;
}

function sequenceItemBlock(records, index) {
  const row = records[index];
  let sequenceIndex = row.sequence ? index : -1;
  if (sequenceIndex < 0) {
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const candidate = records[cursor];
      if (candidate.sequence && candidate.indent < row.indent) {
        sequenceIndex = cursor;
        break;
      }
      if (candidate.indent < row.indent && !candidate.sequence) break;
    }
  }
  if (sequenceIndex < 0) return descendants(records, index);
  const sequence = records[sequenceIndex];
  const rows = [];
  for (let cursor = sequenceIndex; cursor < records.length; cursor += 1) {
    const candidate = records[cursor];
    if (cursor > sequenceIndex && candidate.sequence && candidate.indent === sequence.indent) break;
    if (cursor > sequenceIndex && candidate.indent < sequence.indent) break;
    rows.push(candidate);
  }
  return rows;
}

export function workflowSecurityFacts(source = "") {
  const parsed = parseWorkflowSecurityYaml(source);
  const facts = {
    parseErrors: parsed.errors,
    pullRequestTargetLines: [],
    topLevelPermissions: [],
    permissionWrites: [],
    uses: [],
  };

  for (let index = 0; index < parsed.records.length; index += 1) {
    const row = parsed.records[index];
    if (row.key === "on") {
      if (row.value.includes("pull_request_target")) {
        facts.pullRequestTargetLines.push(row.line);
      }
      for (const child of descendants(parsed.records, index)) {
        if (child.key === "pull_request_target") facts.pullRequestTargetLines.push(child.line);
      }
    }

    if (row.key === "permissions") {
      if (row.indent === 0) facts.topLevelPermissions.push(row);
      if (row.value === "write-all") {
        facts.permissionWrites.push({ permission: "*", line: row.line, writeAll: true, topLevel: row.indent === 0 });
      } else if (/^\{.*\}$/.test(row.value)) {
        const body = row.value.slice(1, -1);
        for (const item of body.split(",")) {
          const pair = splitMapping(item.trim());
          if (!pair) continue;
          const permission = decodeScalar(pair[0]);
          const value = decodeScalar(pair[1]);
          if (value === "write") {
            facts.permissionWrites.push({ permission, line: row.line, writeAll: false, topLevel: row.indent === 0 });
          }
        }
      } else if (!row.value) {
        for (const child of descendants(parsed.records, index)) {
          if (child.value === "write") {
            facts.permissionWrites.push({ permission: child.key, line: child.line, writeAll: false, topLevel: row.indent === 0 });
          }
        }
      }
    }

    if (row.key === "uses") {
      const step = sequenceItemBlock(parsed.records, index);
      const persist = step.find((item) => item.key === "persist-credentials");
      facts.uses.push({
        value: row.value,
        line: row.line,
        checkoutPersistCredentialsFalse: persist?.value === "false",
      });
    }
  }

  facts.pullRequestTargetLines = [...new Set(facts.pullRequestTargetLines)];
  return facts;
}
