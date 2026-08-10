import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../scripts/github-mutate.mjs", import.meta.url),
  "utf8",
);

test("github-mutate delegates routine orchestration to the mutation document executor", () => {
  assert.match(source, /executeMutationDocument/);
  assert.doesNotMatch(source, /executeMutationWithAuthority/);
  assert.match(source, /--request FILE \[--execute\] \[--audit FILE\]/);
});
