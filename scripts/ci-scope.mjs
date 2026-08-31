#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const NODE_COMPAT_PATTERNS = [
  /^scripts\//,
  /^tests\//,
  /^\.github\/npm-publish\//,
  /^\.github-delivery-fixtures\//,
  /^package\.json$/,
  /^\.github\/workflows\/ci\.yml$/,
];

const WINDOWS_AUTHORITY_PATTERNS = [
  /^authority-host\/windows\//,
  /^\.github-delivery-fixtures\//,
  /^global\.json$/,
  /^package\.json$/,
  /^scripts\/ci-scope\.mjs$/,
  /^scripts\/prepare-authority-host-runtime-smoke\.mjs$/,
  /^scripts\/lib\/authority-host-(install|release)\.mjs$/,
  /^\.github\/workflows\/ci\.yml$/,
];

const CSHARP_PATTERNS = [
  /^authority-host\/windows\//,
  /^global\.json$/,
  /^scripts\/ci-scope\.mjs$/,
  /^\.github\/workflows\/codeql\.yml$/,
];

const DOCUMENTATION_PATTERNS = [
  /\.md$/i,
  /^docs\/assets\//,
  /^LICENSE$/,
];

function matchesAny(path, patterns) {
  return patterns.some((pattern) => pattern.test(path));
}

export function parseNullDelimitedPaths(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input || "");
  const paths = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== 0) continue;
    paths.push(buffer.subarray(start, index).toString("utf8"));
    start = index + 1;
  }
  if (start !== buffer.length) {
    throw new Error("ci_scope_input_not_nul_terminated");
  }
  return paths.filter((path) => path.length > 0);
}

export function classifyCiScope(paths = []) {
  return {
    nodeCompat: paths.some((path) => matchesAny(path, NODE_COMPAT_PATTERNS)),
    windowsAuthority: paths.some((path) => matchesAny(path, WINDOWS_AUTHORITY_PATTERNS)),
    csharp: paths.some((path) => matchesAny(path, CSHARP_PATTERNS)),
    javascript: paths.some((path) => !matchesAny(path, DOCUMENTATION_PATTERNS)),
  };
}

export function formatScopeOutput(mode, scope) {
  if (mode === "ci") {
    return [
      `node_compat=${scope.nodeCompat ? "true" : "false"}`,
      `windows_authority=${scope.windowsAuthority ? "true" : "false"}`,
    ].join("\n");
  }
  if (mode === "csharp") {
    return `required=${scope.csharp ? "true" : "false"}`;
  }
  if (mode === "codeql") {
    return [
      `javascript=${scope.javascript ? "true" : "false"}`,
      `csharp=${scope.csharp ? "true" : "false"}`,
    ].join("\n");
  }
  throw new Error(`ci_scope_mode_invalid:${mode || "missing"}`);
}

function parseMode(argv) {
  const index = argv.indexOf("--mode");
  if (index < 0 || !argv[index + 1] || argv[index + 1].startsWith("--")) {
    throw new Error("ci_scope_mode_required");
  }
  if (argv.length !== 2) throw new Error("ci_scope_arguments_invalid");
  return argv[index + 1];
}

export function runCiScope({ mode, input }) {
  const paths = parseNullDelimitedPaths(input);
  return formatScopeOutput(mode, classifyCiScope(paths));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const mode = parseMode(process.argv.slice(2));
    const input = readFileSync(0);
    process.stdout.write(`${runCiScope({ mode, input })}\n`);
  } catch (error) {
    console.error(String(error?.message || error));
    process.exitCode = 2;
  }
}
