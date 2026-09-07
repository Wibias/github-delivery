import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { authorityScopeForRequest, authorityScopeSha256 } from "../../scripts/lib/authority-scope.mjs";
import { exactIdempotencyRecordMatches } from "../../scripts/lib/idempotency-receipt.mjs";
import {
  lifecycleCommandFor,
  validateLifecycleMutation,
} from "../../scripts/lib/lifecycle-mutations.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const ISSUE_LABEL_SCOPE_SHA256 = "b187eadfb73651280dd00887f43260e0729d24a94ed49ca3fc5683acd5cef729";

function request(overrides = {}) {
  return {
    schemaVersion: 1,
    action: "create_issue",
    mutationMode: "maintainer",
    explicitInstruction: true,
    repo: "acme/widgets",
    title: "Add traced launcher UX",
    body: "Body\n\n<!-- github-delivery:idempotency aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa -->",
    idempotencyKey: "issue-label-contract",
    idempotencyMarker: "<!-- github-delivery:idempotency aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa -->",
    labels: ["triage", "enhancement", "enhancement"],
    ...overrides,
  };
}

test("create_issue validates and emits a deterministic label set", () => {
  const input = request();
  assert.equal(validateLifecycleMutation(input), true);
  assert.deepEqual(lifecycleCommandFor(input), [
    "gh",
    "issue",
    "create",
    "--repo",
    "acme/widgets",
    "--title",
    "Add traced launcher UX",
    "--body",
    input.body,
    "--label",
    "enhancement",
    "--label",
    "triage",
  ]);

  assert.throws(
    () => validateLifecycleMutation(request({ labels: "enhancement" })),
    /labels_invalid/,
  );
  assert.throws(
    () => validateLifecycleMutation(request({ labels: ["enhancement", " "] })),
    /label_invalid|labels_entry_invalid/,
  );
});

test("create_issue labels are part of the exact authority scope", () => {
  const scope = authorityScopeForRequest(request());
  assert.deepEqual(scope.labels, ["enhancement", "triage"]);
  assert.equal(authorityScopeSha256(request()), ISSUE_LABEL_SCOPE_SHA256);
  assert.notEqual(
    authorityScopeSha256(request()),
    authorityScopeSha256(request({ labels: ["bug"] })),
  );
  assert.equal(
    Object.hasOwn(authorityScopeForRequest(request({ labels: undefined })), "labels"),
    false,
  );
});

test("Windows authority binds create_issue labels through the same canonical string-set path", () => {
  const source = readFileSync(
    resolve(
      ROOT,
      "authority-host",
      "windows",
      "GitHubDeliveryAuthority",
      "ScopeCanonicalizer.cs",
    ),
    "utf8",
  );
  assert.match(
    source,
    /case "create_issue":\s*case "create_follow_up_issue":[\s\S]*?var labels = CanonicalStringSet\(request, "labels", optional: true\);[\s\S]*?if \(labels\.Count > 0\) scope\["labels"\] = labels;/,
  );
});

test("create_issue idempotency requires every requested label but permits server-added labels", () => {
  const input = request();
  const baseRecord = {
    user: { login: "wibias" },
    title: input.title,
    body: input.body,
    labels: [
      { name: "enhancement" },
      { name: "triage" },
      { name: "server-added" },
    ],
  };

  assert.equal(
    exactIdempotencyRecordMatches({ record: baseRecord, request: input, actorLogin: "Wibias" }),
    true,
  );
  assert.equal(
    exactIdempotencyRecordMatches({
      record: { ...baseRecord, labels: [{ name: "enhancement" }] },
      request: input,
      actorLogin: "Wibias",
    }),
    false,
  );
});
