import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { syntaxCheckTargets } from "../../scripts/check-syntax.mjs";

const ROOT = resolve(import.meta.dirname, "../..");

test("syntax checker covers runtime modules and all unit tests", () => {
  const targets = syntaxCheckTargets(ROOT);
  for (const expected of [
    "scripts/github-mutate.mjs",
    "scripts/lib/mutation-document-execution.mjs",
    "scripts/lib/mutation-execution-context.mjs",
    "tests/unit/mutation-document-execution.test.mjs",
    "tests/unit/authority-runtime-defaults.test.mjs",
    "tests/unit/token-efficient-workflow-contract.test.mjs",
    "tests/unit/github-mutate-entrypoint.test.mjs",
    "tests/unit/check-syntax-contract.test.mjs",
  ]) {
    assert.ok(targets.includes(expected), expected);
  }
  assert.equal(new Set(targets).size, targets.length);
  assert.ok(targets.every((path) => path.endsWith(".mjs")));
});
