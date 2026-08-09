import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  actionDefinition,
  mutationActionNames,
} from "../../scripts/lib/mutation-action-registry.mjs";

const BROKER = readFileSync(
  new URL("../../scripts/lib/github-mutation-broker.mjs", import.meta.url),
  "utf8",
);

function parseSet(name) {
  const match = BROKER.match(
    new RegExp(`const\\s+${name}\\s*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\);`),
  );
  assert.ok(match, `broker set ${name} missing`);
  return [...match[1].matchAll(/["']([^"']+)["']/g)].map((row) => row[1]).sort();
}

function registryLegacy(property) {
  return mutationActionNames({ enabledOnly: false })
    .map((action) => actionDefinition(action))
    .filter(
      (definition) =>
        definition.route === "legacy" && definition[property] === true,
    )
    .map((definition) => definition.action)
    .sort();
}

test("broker PR-bound actions match registry semantics", () => {
  assert.deepEqual(parseSet("PR_ACTIONS"), registryLegacy("prBound"));
});

test("broker social actions match registry semantics", () => {
  assert.deepEqual(parseSet("SOCIAL_ACTIONS"), registryLegacy("social"));
});

test("broker remote-idempotent create actions match registry semantics", () => {
  assert.deepEqual(
    parseSet("REMOTE_IDEMPOTENT_CREATE_ACTIONS"),
    registryLegacy("remoteIdempotentCreate"),
  );
});

test("broker review-thread actions match registry semantics", () => {
  assert.deepEqual(parseSet("REVIEW_THREAD_ACTIONS"), registryLegacy("reviewThread"));
});

test("broker cleanup actions match registry semantics", () => {
  assert.deepEqual(parseSet("CLEANUP_ACTIONS"), registryLegacy("cleanup"));
});
