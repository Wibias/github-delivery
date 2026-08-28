import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { validateMutationBoundarySource } from "../../scripts/lib/mutation-boundary-security.mjs";

const path = "scripts/lib/github-approval-mutation-broker.mjs";

test("production approval broker stays inside its exact registered mutation boundary", () => {
  const source = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const errors = validateMutationBoundarySource(path, source);
  assert.deepEqual(errors, [], JSON.stringify(errors));
});
