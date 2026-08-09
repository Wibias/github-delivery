import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateMutationBoundaryTree } from "../../scripts/lib/mutation-boundary-security.mjs";

function fixture(path, source) {
  const root = mkdtempSync(join(tmpdir(), "github-delivery-mutation-boundary-"));
  const target = join(root, path);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, source, "utf8");
  return root;
}

function codes(report) {
  return report.errors.map((error) => error.code);
}

test("rejects a direct gh pr mutation in a production helper", () => {
  const root = fixture(
    "scripts/helper.mjs",
    'spawnSync("gh", ["pr", "comment", "42", "--body", "oops"]);\n',
  );
  const report = validateMutationBoundaryTree(root);
  assert.equal(report.valid, false);
  assert.ok(codes(report).includes("direct_gh_mutation"));
});

test("rejects a mutating gh api REST call outside the broker", () => {
  const root = fixture(
    "scripts/helper.mjs",
    'spawnSync("gh", ["api", "repos/acme/widgets/pulls/1", "--method", "PATCH"]);\n',
  );
  const report = validateMutationBoundaryTree(root);
  assert.equal(report.valid, false);
  assert.ok(codes(report).includes("direct_gh_api_mutation"));
});

test("rejects a GraphQL mutation outside the broker", () => {
  const root = fixture(
    "scripts/helper.mjs",
    'const query = `mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{id}}}`;\nspawnSync("gh", ["api", "graphql", "-f", `query=${query}`]);\n',
  );
  const report = validateMutationBoundaryTree(root);
  assert.equal(report.valid, false);
  assert.ok(codes(report).includes("direct_graphql_mutation"));
});

test("rejects git push outside the lifecycle mutation implementation", () => {
  const root = fixture(
    "scripts/helper.mjs",
    'execFileSync("git", ["push", "origin", "HEAD:refs/heads/main"]);\n',
  );
  const report = validateMutationBoundaryTree(root);
  assert.equal(report.valid, false);
  assert.ok(codes(report).includes("direct_git_push"));
});

test("read-only gh commands remain allowed", () => {
  const root = fixture(
    "scripts/helper.mjs",
    'spawnSync("gh", ["pr", "view", "42", "--json", "headRefOid"]);\n',
  );
  const report = validateMutationBoundaryTree(root);
  assert.equal(report.valid, true, JSON.stringify(report.errors));
});

test("the canonical broker implementation may contain GitHub mutation commands", () => {
  const root = fixture(
    "scripts/lib/github-mutation-broker.mjs",
    'const command = ["gh", "pr", "merge", "42"];\nconst query = `mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{id}}}`;\n',
  );
  const report = validateMutationBoundaryTree(root);
  assert.equal(report.valid, true, JSON.stringify(report.errors));
});

test("the lifecycle mutation implementation may contain the brokered git push primitive", () => {
  const root = fixture(
    "scripts/lib/lifecycle-mutations.mjs",
    'const command = ["git", "push", "origin", "HEAD:refs/heads/feature"];\n',
  );
  const report = validateMutationBoundaryTree(root);
  assert.equal(report.valid, true, JSON.stringify(report.errors));
});
