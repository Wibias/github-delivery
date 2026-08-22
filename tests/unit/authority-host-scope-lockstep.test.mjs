import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { authorityScopeSha256 } from "../../scripts/lib/authority-scope.mjs";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const host = "authority-host/windows/GitHubDeliveryAuthority";

function switchCase(source, action) {
  const escaped = action.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`case "${escaped}":[\\s\\S]*?break;`))?.[0] || "";
}

test("Windows merge_pr canonicalizer binds expected base name and OID", () => {
  const mergeCase = switchCase(read(`${host}/ScopeCanonicalizer.cs`), "merge_pr");
  assert.match(mergeCase, /scope\["expectedBase"\] = RequiredString\(request, "expectedBase"\)/);
  assert.match(mergeCase, /scope\["expectedBaseOid"\]/);
  assert.match(mergeCase, /expectedBaseOid/);
});

test("Windows close_linked_issue canonicalizer binds the governing PR", () => {
  const closeCase = switchCase(read(`${host}/ScopeCanonicalizer.cs`), "close_linked_issue");
  assert.match(closeCase, /scope\["pr"\]/);
  assert.match(closeCase, /scope\["issue"\] = PositiveInt\(request, "issue"\)/);
});

test("host SelfTest merge fixture hashes under the Node canonicalizer", () => {
  const selfTest = read(`${host}/SelfTest.cs`);
  const pinned = selfTest.match(/ExpectedMergeScope = "([0-9a-f]{64})"/)?.[1];
  const fixture = selfTest.match(
    /JsonDocument\.Parse\("""\s*(\{"schemaVersion":1,"action":"merge_pr".*?\})\s*"""\)/,
  )?.[1];
  assert.equal(typeof pinned, "string");
  assert.equal(typeof fixture, "string");
  const request = JSON.parse(fixture);
  assert.equal(request.expectedBase, "main");
  assert.equal(typeof request.expectedBaseOid, "string");
  assert.equal(authorityScopeSha256(request), pinned);
});
