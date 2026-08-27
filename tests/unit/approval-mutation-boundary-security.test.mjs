import assert from "node:assert/strict";
import test from "node:test";

import { validateMutationBoundarySource } from "../../scripts/lib/mutation-boundary-security.mjs";

const APPROVAL_BROKER = "scripts/lib/github-approval-mutation-broker.mjs";

test("approval broker may submit only the native PR review mutation", () => {
  const errors = validateMutationBoundarySource(
    APPROVAL_BROKER,
    'const command = ["gh", "pr", "review", "42", "--approve"];\n',
  );
  assert.deepEqual(errors, []);
});

test("approval broker cannot inherit generic PR mutation authority", () => {
  const errors = validateMutationBoundarySource(
    APPROVAL_BROKER,
    'const command = ["gh", "pr", "merge", "42"];\n',
  );
  assert.ok(
    errors.some((item) => item.code === "direct_gh_mutation" && item.group === "pr" && item.verb === "merge"),
    JSON.stringify(errors),
  );
});
