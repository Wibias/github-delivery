import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "bundledDependencies",
  "bundleDependencies",
];
const NODE_LOCKFILES = [
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
];
const NUGET_MANIFEST_NAMES = new Set([
  "Directory.Packages.props",
  "packages.config",
]);
const NUGET_PROJECT_EXTENSIONS = [".csproj", ".fsproj", ".vbproj"];
const NUGET_LOCKFILE_NAMES = new Set(["packages.lock.json"]);
const SKIP_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  "bin",
  "obj",
]);

function entries(value) {
  if (Array.isArray(value)) return value.map((name) => [name, "bundled"]);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value);
}

function portableRelative(root, path) {
  return relative(root, path).split("\\").join("/");
}

function nestedDependencyFiles(root) {
  const manifests = [];
  const lockfiles = [];

  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;

      const path = portableRelative(root, absolute);
      if (NUGET_LOCKFILE_NAMES.has(entry.name)) {
        lockfiles.push(path);
        continue;
      }
      if (
        NUGET_MANIFEST_NAMES.has(entry.name) ||
        NUGET_PROJECT_EXTENSIONS.some((extension) => entry.name.endsWith(extension))
      ) {
        manifests.push(path);
      }
    }
  }

  walk(root);
  return {
    manifests: manifests.sort(),
    lockfiles: lockfiles.sort(),
  };
}

export function dependencyInventory(root = process.cwd()) {
  root = resolve(root);
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const dependencies = DEPENDENCY_FIELDS.flatMap((field) =>
    entries(pkg[field]).map(([name, version]) => ({ field, name, version })),
  ).sort((left, right) => `${left.field}:${left.name}`.localeCompare(`${right.field}:${right.name}`));
  const nested = nestedDependencyFiles(root);
  const rootNodeLockfiles = NODE_LOCKFILES.filter((name) => existsSync(join(root, name)));
  const lockfiles = [...new Set([...rootNodeLockfiles, ...nested.lockfiles])].sort();
  return {
    dependencies,
    manifests: nested.manifests,
    lockfiles,
  };
}

export function evaluateDependencyReviewFallback({ outcome, root = process.cwd() } = {}) {
  if (outcome === "success") {
    return {
      schemaVersion: 1,
      kind: "github-delivery/dependency-review-fallback",
      decision: "authoritative_pass",
      degraded: false,
      dependencies: [],
      manifests: [],
      lockfiles: [],
    };
  }
  const inventory = dependencyInventory(root);
  const dependencyFree =
    inventory.dependencies.length === 0 &&
    inventory.manifests.length === 0 &&
    inventory.lockfiles.length === 0;
  return {
    schemaVersion: 1,
    kind: "github-delivery/dependency-review-fallback",
    decision: dependencyFree ? "dependency_free_degraded_pass" : "blocked",
    degraded: true,
    reason: dependencyFree
      ? "GitHub dependency review was unavailable, but the repository declares no dependencies and contains no supported dependency manifest or lockfile."
      : "GitHub dependency review failed or was unavailable while dependencies, dependency manifests, or lockfiles exist.",
    ...inventory,
  };
}
