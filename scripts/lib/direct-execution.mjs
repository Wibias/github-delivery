import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function isDirectExecution(metaUrl, entry = process.argv[1]) {
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}
