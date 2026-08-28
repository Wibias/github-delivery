import assert from "node:assert/strict";
import test from "node:test";

import { validateMutationBoundarySource } from "../../scripts/lib/mutation-boundary-security.mjs";

const BROKER = "scripts/lib/github-mutation-broker.mjs";

function errorsFor(query) {
  const source = [
    `const query = ${JSON.stringify(query)};`,
    'spawnSync("gh", ["api", "graphql", "-f", `query=${query}`]);',
  ].join("\n");
  return validateMutationBoundarySource(BROKER, source);
}

test("privileged broker rejects an unregistered GraphQL mutation hidden behind a fragment spread", () => {
  const errors = errorsFor(
    "mutation Hidden($id:ID!){...Mut} fragment Mut on Mutation { addStar(input:{starrableId:$id}){clientMutationId} }",
  );
  assert.ok(
    errors.some((error) => error.code === "unregistered_graphql_mutation"),
    JSON.stringify(errors),
  );
});

test("privileged broker rejects an unregistered GraphQL mutation hidden behind an inline fragment", () => {
  const errors = errorsFor(
    "mutation Hidden($id:ID!){... on Mutation { addStar(input:{starrableId:$id}){clientMutationId} }}",
  );
  assert.ok(
    errors.some((error) => error.code === "unregistered_graphql_mutation"),
    JSON.stringify(errors),
  );
});
