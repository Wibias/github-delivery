#!/usr/bin/env node
import { readdirSync } from "node:fs";
import { resolve, relative, join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

function toPosix(path) {
  return path.split(sep).join("/");
}

function collectMjs(root, start, output) {
  const absolute = join(root, start);
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const path = join(absolute, entry.name);
    if (entry.isDirectory()) collectMjs(root, toPosix(relative(root, path)), output);
    else if (entry.isFile() && entry.name.endsWith(".mjs")) output.push(toPosix(relative(root, path)));
  }
}

export function syntaxCheckTargets(root = process.cwd()) {
  root = resolve(root);
  const targets = [];
  collectMjs(root, "scripts", targets);
  collectMjs(root, "tests/unit", targets);
  return [...new Set(targets)].sort();
}

export function checkSyntax({ root = process.cwd(), spawn = spawnSync } = {}) {
  root = resolve(root);
  const failures = [];
  for (const path of syntaxCheckTargets(root)) {
    const result = spawn(process.execPath, ["--check", join(root, ...path.split("/"))], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.status !== 0) {
      failures.push({ path, stderr: String(result.stderr || result.stdout || "").trim() });
    }
  }
  if (failures.length > 0) {
    for (const failure of failures) {
      process.stderr.write(`${failure.path}\n${failure.stderr}\n`);
    }
    return false;
  }
  return true;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!checkSyntax()) process.exitCode = 1;
}
