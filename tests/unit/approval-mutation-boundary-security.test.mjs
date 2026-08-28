import assert from "node:assert/strict";
import test from "node:test";

import { validateMutationBoundarySource } from "../../scripts/lib/mutation-boundary-security.mjs";

const APPROVAL_BROKER = "scripts/lib/github-approval-mutation-broker.mjs";

test("approval broker may submit only the exact native review REST mutation", () => {
  const errors = validateMutationBoundarySource(
    APPROVAL_BROKER,
    [
      'const repo = "acme/widgets";',
      "const pr = 42;",
      'const command = ["gh", "api", `repos/${repo}/pulls/${pr}/reviews`, "--method", "POST"];',
    ].join("\n"),
  );
  assert.deepEqual(errors, []);
});

test("approval broker cannot fall back to unbound gh pr review", () => {
  const errors = validateMutationBoundarySource(
    APPROVAL_BROKER,
    'const command = ["gh", "pr", "review", "42", "--approve"];\n',
  );
  assert.ok(
    errors.some((item) => item.code === "direct_gh_mutation" && item.group === "pr" && item.verb === "review"),
    JSON.stringify(errors),
  );
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

test("approval broker cannot mutate another REST endpoint", () => {
  const errors = validateMutationBoundarySource(
    APPROVAL_BROKER,
    'const command = ["gh", "api", "repos/acme/widgets/issues/42", "--method", "PATCH"];\n',
  );
  assert.ok(errors.some((item) => item.code === "direct_gh_api_mutation"), JSON.stringify(errors));
});
