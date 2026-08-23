import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  authorityScopeForRequest,
  authorityScopeSha256,
} from "../../scripts/lib/authority-scope.mjs";

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

test("Windows Hello names rewrite exemptions and keeps them off leases and PR sessions", () => {
  const service = read(`${host}/AuthorityService.cs`);
  const classifier = read(`${host}/MutationClassifier.cs`);
  const selfTest = read(`${host}/SelfTest.cs`);
  assert.match(service, /content-changing non-fast-forward rewrite allowed: \{rewriteExemption\}/);
  assert.match(classifier, /HasRewriteExemption/);
  assert.match(classifier, /IsBranchLeaseEligible[\s\S]*!HasRewriteExemption\(operation\)/);
  assert.match(classifier, /IsPrSessionEligible[\s\S]*!HasRewriteExemption\(operation\)/);
  assert.match(selfTest, /content-changing non-fast-forward rewrite allowed: restack/);
  assert.match(selfTest, /exempt rewrite must not reuse a branch lease/);
  assert.match(selfTest, /exempt rewrite Hello presentation must differ from an ordinary push/);
});

test("Windows push_code canonicalizer omits empty rewrite exemptions and binds exact allowlisted values", () => {
  const canonicalizer = read(`${host}/ScopeCanonicalizer.cs`);
  const pushCase = switchCase(canonicalizer, "push_code");
  const helper = canonicalizer.match(/OptionalRewriteExemption\(JsonElement request\)[\s\S]*?return text;/)?.[0] || "";
  const selfTest = read(`${host}/SelfTest.cs`);
  assert.match(pushCase, /OptionalRewriteExemption\(request\)/);
  assert.match(pushCase, /scope\["rewriteExemption"\] = rewriteExemption/);
  assert.doesNotMatch(pushCase, /\.Trim\(\)/);
  assert.doesNotMatch(helper, /\.Trim\(\)/);
  assert.match(helper, /"restack" or "conflicts" or "simplify-pr"/);
  const noneHash = selfTest.match(/ExpectedPushScopeNone = "([0-9a-f]{64})"/)?.[1];
  const emptyNeedle =
    '{"schemaVersion":1,"action":"push_code","mutationMode":"maintainer","explicitInstruction":true,"repo":"Wibias/github-delivery","remote":"origin","branch":"feature/safe","expectedRemoteTip":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","newTip":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","forceWithLease":true,"rewriteExemption":""}';
  assert.equal(typeof noneHash, "string");
  assert.ok(selfTest.includes(emptyNeedle));
  assert.match(selfTest, /empty rewrite exemption must hash as omitted/);
  const emptyRequest = JSON.parse(emptyNeedle);
  assert.equal(emptyRequest.rewriteExemption, "");
  assert.equal("rewriteExemption" in authorityScopeForRequest(emptyRequest), false);
  assert.equal(authorityScopeSha256(emptyRequest), noneHash);
});

test("Node and Windows reject the same non-string rewriteExemption shapes", () => {
  const canonicalizer = read(`${host}/ScopeCanonicalizer.cs`);
  const classifier = read(`${host}/MutationClassifier.cs`);
  const selfTest = read(`${host}/SelfTest.cs`);
  assert.match(canonicalizer, /OptionalRewriteExemption\(JsonElement request\)/);
  assert.match(canonicalizer, /value\.ValueKind != JsonValueKind\.String/);
  assert.match(canonicalizer, /authority_scope_rewrite_exemption_invalid/);
  assert.doesNotMatch(
    switchCase(canonicalizer, "push_code"),
    /OptionalString\(request, "rewriteExemption"\)/,
  );
  assert.match(classifier, /HasRewriteExemption[\s\S]*OptionalRewriteExemption/);
  const request = {
    schemaVersion: 1,
    action: "push_code",
    mutationMode: "maintainer",
    explicitInstruction: true,
    repo: "Wibias/github-delivery",
    remote: "origin",
    branch: "feature/safe",
    expectedRemoteTip: "a".repeat(40),
    newTip: "b".repeat(40),
    forceWithLease: true,
  };
  const malformed = [
    ["MalformedArray", ["restack"]],
    ["MalformedObject", { kind: "restack" }],
    ["MalformedNumber", 1],
    ["MalformedBoolean", true],
    ["PaddedRestack", " restack "],
    ["WhitespaceOnly", " "],
    ["UnknownAmend", "amend"],
  ];
  for (const [label, rewriteExemption] of malformed) {
    const needle = JSON.stringify({ ...request, rewriteExemption });
    assert.ok(selfTest.includes(needle), `missing SelfTest fixture ${label}`);
    assert.match(
      selfTest,
      new RegExp(
        `${label}[\\s\\S]*ScopeCanonicalizer\\.ScopeSha256[\\s\\S]*authority_scope_rewrite_exemption_invalid`,
      ),
    );
    assert.throws(
      () => authorityScopeSha256({ ...request, rewriteExemption }),
      /authority_scope_rewrite_exemption_invalid/,
      label,
    );
  }
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
