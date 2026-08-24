import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { userConfigPath } from "./user-config.mjs";

function required(value, name) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`${name}_required`);
  }
  return value;
}

function exactSha(value, name) {
  const sha = String(required(value, name)).toLowerCase();
  if (!/^[0-9a-f]{40,64}$/.test(sha)) throw new Error(`${name}_invalid`);
  return sha;
}

export function rewriteBaselineScopeKey({ repo, remote, branch }) {
  return `${String(required(repo, "repo")).toLowerCase()}\n${required(remote, "remote")}\n${required(branch, "branch")}`;
}

export function rewriteBaselineStorePath(options = {}) {
  return join(dirname(userConfigPath(options)), "rewrite-baselines.json");
}

function createStore(readAll, writeAll) {
  return {
    read(scope) {
      const value = readAll()[rewriteBaselineScopeKey(scope)];
      if (value == null) return null;
      return exactSha(value, "original_local_tip_baseline");
    },
    create(scope, originalLocalTip) {
      const data = readAll();
      const key = rewriteBaselineScopeKey(scope);
      if (data[key]) throw new Error("rewrite_baseline_already_exists");
      data[key] = exactSha(originalLocalTip, "original_local_tip");
      writeAll(data);
      return data[key];
    },
    consume(scope) {
      const data = readAll();
      const key = rewriteBaselineScopeKey(scope);
      const value = data[key];
      if (value == null) return null;
      const sha = exactSha(value, "original_local_tip_baseline");
      delete data[key];
      writeAll(data);
      return sha;
    },
  };
}

export function createMemoryRewriteBaselineStore() {
  const data = {};
  return createStore(
    () => ({ ...data }),
    (next) => {
      for (const key of Object.keys(data)) delete data[key];
      Object.assign(data, next);
    },
  );
}

export function createFileRewriteBaselineStore({
  path,
  exists = existsSync,
  mkdir = mkdirSync,
  readFile = readFileSync,
  writeFile = writeFileSync,
  rename = renameSync,
} = {}) {
  const filePath = path || rewriteBaselineStorePath();
  return createStore(
    () => {
      if (!exists(filePath)) return {};
      let parsed;
      try {
        parsed = JSON.parse(readFile(filePath, "utf8"));
      } catch {
        throw new Error("rewrite_baseline_store_unreadable");
      }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("rewrite_baseline_store_unreadable");
      }
      return parsed;
    },
    (next) => {
      mkdir(dirname(filePath), { recursive: true });
      const tempPath = `${filePath}.${process.pid}-${Date.now()}.tmp`;
      writeFile(tempPath, `${JSON.stringify(next)}\n`, { encoding: "utf8", mode: 0o600 });
      rename(tempPath, filePath);
    },
  );
}
