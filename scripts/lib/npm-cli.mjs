import { existsSync } from "node:fs";
import { dirname, extname, join } from "node:path";

function isJavascriptCli(path) {
  const ext = extname(path).toLowerCase();
  return ext === ".js" || ext === ".cjs" || ext === ".mjs";
}

export function resolveNpmCli({
  execPath = process.execPath,
  env = process.env,
} = {}) {
  const fromEnv = String(env?.npm_execpath || "").trim();
  const nodeDir = dirname(execPath);
  const candidates = [
    fromEnv,
    join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
    join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  for (const candidate of candidates) {
    if (!candidate || !isJavascriptCli(candidate)) continue;
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("npm_cli_unreadable");
}
