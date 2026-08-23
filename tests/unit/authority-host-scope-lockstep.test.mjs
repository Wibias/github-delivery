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

test("Windows push_code canonicalizer omits empty rewrite exemptions and binds the rest", () => {
  const pushCase = switchCase(read(`${host}/ScopeCanonicalizer.cs`), "push_code");
  assert.match(pushCase, /rewriteExemption/);
  assert.match(pushCase, /OptionalString\(request, "rewriteExemption"\)/);
  assert.match(pushCase, /scope\["rewriteExemption"\] = rewriteExemption/);
});

test("host SelfTest push rewrite-exemption fixtures hash under the Node canonicalizer", () => {
  const selfTest = read(`${host}/SelfTest.cs`);
  const cases = [
    ["None", undefined],
    ["Restack", "restack"],
    ["Conflicts", "conflicts"],
    ["SimplifyPr", "simplify-pr"],
  ];
  const hashes = new Set();
  for (const [label, exemption] of cases) {
    const pinned = selfTest.match(
      new RegExp(`ExpectedPushScope${label} = "([0-9a-f]{64})"`),
    )?.[1];
    const needle =
      exemption === undefined
        ? '{"schemaVersion":1,"action":"push_code","mutationMode":"maintainer","explicitInstruction":true,"repo":"Wibias/github-delivery","remote":"origin","branch":"feature/safe","expectedRemoteTip":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","newTip":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","forceWithLease":true}'
        : `{"schemaVersion":1,"action":"push_code","mutationMode":"maintainer","explicitInstruction":true,"repo":"Wibias/github-delivery","remote":"origin","branch":"feature/safe","expectedRemoteTip":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","newTip":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","forceWithLease":true,"rewriteExemption":"${exemption}"}`;
    assert.equal(typeof pinned, "string", `missing ExpectedPushScope${label}`);
    assert.ok(selfTest.includes(needle));
    const request = JSON.parse(needle);
    assert.equal(authorityScopeSha256(request), pinned, label);
    hashes.add(pinned);
  }
  assert.equal(hashes.size, 4);
});
