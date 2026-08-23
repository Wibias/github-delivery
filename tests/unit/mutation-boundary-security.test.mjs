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

test("rejects a dynamic gh mutation-capable verb slot", () => {
  const root = fixture(
    "scripts/helper.mjs",
    'const verb = "comment";\nspawnSync("gh", ["pr", verb, "42", "--body", "oops"]);\n',
  );
  const report = validateMutationBoundaryTree(root);
  assert.equal(report.valid, false);
  assert.ok(codes(report).includes("dynamic_gh_verb"));
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

test("rejects a dynamic gh api HTTP method outside the broker", () => {
  const root = fixture(
    "scripts/helper.mjs",
    'const method = "PATCH";\nspawnSync("gh", ["api", "repos/acme/widgets/pulls/1", "--method", method]);\n',
  );
  const report = validateMutationBoundaryTree(root);
  assert.equal(report.valid, false);
  assert.ok(codes(report).includes("dynamic_gh_api_method"));
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

test("privileged mutation files still reject secret and variable writes", () => {
  const secret = fixture(
    "scripts/lib/github-mutation-broker.mjs",
    'spawnSync("gh", ["secret", "set", "TOKEN"]);\n',
  );
  const secretReport = validateMutationBoundaryTree(secret);
  assert.equal(secretReport.valid, false);
  assert.ok(codes(secretReport).includes("direct_gh_mutation"));

  const variable = fixture(
    "scripts/lib/lifecycle-mutations.mjs",
    'spawnSync("gh", ["variable", "set", "FLAG"]);\n',
  );
  const variableReport = validateMutationBoundaryTree(variable);
  assert.equal(variableReport.valid, false);
  assert.ok(codes(variableReport).includes("direct_gh_mutation"));
});

test("the lifecycle mutation implementation may contain the brokered git push primitive", () => {
  const root = fixture(
    "scripts/lib/lifecycle-mutations.mjs",
    'const command = ["git", "push", "origin", "HEAD:refs/heads/feature"];\n',
  );
  const report = validateMutationBoundaryTree(root);
  assert.equal(report.valid, true, JSON.stringify(report.errors));
});

test("rejects a GitHub mutation whose argv is built in a variable", () => {
  const root = fixture(
    "scripts/helper.mjs",
    'const args = ["secret", "set", "TOKEN"];\nspawnSync("gh", args);\n',
  );
  const report = validateMutationBoundaryTree(root);
  assert.equal(report.valid, false);
  assert.ok(
    codes(report).includes("direct_gh_mutation") || codes(report).includes("dynamic_gh_argv"),
    JSON.stringify(report.errors),
  );
});

test("rejects a GitHub mutation whose argv is spread from another array", () => {
  const root = fixture(
    "scripts/helper.mjs",
    'const args = ["secret", "set", "TOKEN"];\nspawnSync("gh", [...args]);\n',
  );
  const report = validateMutationBoundaryTree(root);
  assert.equal(report.valid, false);
  assert.ok(
    codes(report).includes("direct_gh_mutation") || codes(report).includes("dynamic_gh_argv"),
    JSON.stringify(report.errors),
  );
});

test("privileged mutation files reject mutating REST endpoints outside the registry shape", () => {
  const root = fixture(
    "scripts/lib/github-mutation-broker.mjs",
    'spawnSync("gh", ["api", "repos/acme/widgets/actions/secrets/TOKEN", "--method", "PUT"]);\n',
  );
  const report = validateMutationBoundaryTree(root);
  assert.equal(report.valid, false);
  assert.ok(codes(report).includes("unregistered_gh_api_mutation"), JSON.stringify(report.errors));
});

test("privileged mutation files reject GraphQL mutations outside the registry set", () => {
  const root = fixture(
    "scripts/lib/github-mutation-broker.mjs",
    'spawnSync("gh", ["api", "graphql", "-f", "query=mutation { addStar(input:{starrableId:\\"x\\"}) { clientMutationId } }"]);\n',
  );
  const report = validateMutationBoundaryTree(root);
  assert.equal(report.valid, false);
  assert.ok(codes(report).includes("unregistered_graphql_mutation"), JSON.stringify(report.errors));
});

test("read-only gh wrappers that take an args parameter remain allowed", () => {
  const root = fixture(
    "scripts/helper.mjs",
    'function ghOk(args) {\n  return boundedSpawnSync("gh", args);\n}\nghOk(["pr", "view", "42"]);\n',
  );
  const report = validateMutationBoundaryTree(root);
  assert.equal(report.valid, true, JSON.stringify(report.errors));
});
