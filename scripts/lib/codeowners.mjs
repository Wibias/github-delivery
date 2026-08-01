function stripInlineComment(line) {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line;
}

export function patternToRegex(pattern) {
  let value = String(pattern || "").trim();
  if (!value || value.startsWith("#")) return null;

  let anchoredRoot = false;
  if (value.startsWith("/")) {
    anchoredRoot = true;
    value = value.slice(1);
  }
  const directoryOnly = value.endsWith("/");
  if (directoryOnly) value = value.slice(0, -1);

  let expression = "";
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === "*" && value[index + 1] === "*") {
      expression += ".*";
      index++;
      if (value[index + 1] === "/") index++;
    } else if (character === "*") {
      expression += "[^/]*";
    } else if (character === "?") {
      expression += "[^/]";
    } else if (".+^$()[]{}|\\".includes(character)) {
      expression += `\\${character}`;
    } else {
      expression += character;
    }
  }

  if (directoryOnly) expression += "(?:/.*)?";
  return anchoredRoot
    ? new RegExp(`^${expression}$`)
    : new RegExp(`(^|/)${expression}$`);
}

export function parseCodeowners(text) {
  const rules = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = stripInlineComment(raw).trim();
    if (!line || line.startsWith("#")) continue;
    const [pattern, ...owners] = line.split(/\s+/);
    const regex = patternToRegex(pattern);
    if (!regex) continue;
    rules.push({ pattern, owners, regex });
  }
  return rules;
}

export function ownersForPath(rules, filePath) {
  let matched = null;
  for (const rule of rules || []) {
    if (rule.regex.test(filePath)) matched = rule;
  }
  return matched
    ? { pattern: matched.pattern, owners: [...matched.owners] }
    : null;
}
