import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

function canonicalFileUrl(value, { realpath = realpathSync } = {}) {
  const filePath = String(value || "").startsWith("file:")
    ? fileURLToPath(value)
    : String(value || "");
  if (!filePath) return null;
  try {
    return pathToFileURL(realpath(filePath)).href;
  } catch {
    return pathToFileURL(filePath).href;
  }
}

export function isDirectInvocation(
  moduleUrl,
  argv1 = process.argv[1],
  options = {},
) {
  if (!moduleUrl || !argv1) return false;
  return canonicalFileUrl(moduleUrl, options) === canonicalFileUrl(argv1, options);
}
