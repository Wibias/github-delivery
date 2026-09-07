import assert from "node:assert/strict";
import test from "node:test";

import { authorityScopeForRequest, authorityScopeSha256 } from "../../scripts/lib/authority-scope.mjs";
import { exactIdempotencyRecordMatches } from "../../scripts/lib/idempotency-receipt.mjs";
import {
  lifecycleCommandFor,
  validateLifecycleMutation,
} from "../../scripts/lib/lifecycle-mutations.mjs";

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
  assert.notEqual(
    authorityScopeSha256(request()),
    authorityScopeSha256(request({ labels: ["bug"] })),
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
