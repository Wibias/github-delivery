import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "bundledDependencies",
  "bundleDependencies",
];
const LOCKFILES = [
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
];

function entries(value) {
  if (Array.isArray(value)) return value.map((name) => [name, "bundled"]);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value);
}

export function dependencyInventory(root = process.cwd()) {
  root = resolve(root);
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const dependencies = DEPENDENCY_FIELDS.flatMap((field) =>
    entries(pkg[field]).map(([name, version]) => ({ field, name, version })),
  ).sort((left, right) => `${left.field}:${left.name}`.localeCompare(`${right.field}:${right.name}`));
  const lockfiles = LOCKFILES.filter((name) => existsSync(join(root, name)));
  return { dependencies, lockfiles };
}

export function evaluateDependencyReviewFallback({ outcome, root = process.cwd() } = {}) {
  if (outcome === "success") {
    return {
      schemaVersion: 1,
      kind: "github-delivery/dependency-review-fallback",
      decision: "authoritative_pass",
      degraded: false,
      dependencies: [],
      lockfiles: [],
    };
  }
  const inventory = dependencyInventory(root);
  const dependencyFree = inventory.dependencies.length === 0 && inventory.lockfiles.length === 0;
  return {
    schemaVersion: 1,
    kind: "github-delivery/dependency-review-fallback",
    decision: dependencyFree ? "dependency_free_degraded_pass" : "blocked",
    degraded: true,
    reason: dependencyFree
      ? "GitHub dependency review was unavailable, but the repository declares no dependencies and contains no lockfile."
      : "GitHub dependency review failed or was unavailable while dependencies or lockfiles exist.",
    ...inventory,
  };
}
