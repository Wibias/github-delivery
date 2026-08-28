import assert from "node:assert/strict";
import test from "node:test";

import { classifyShipGateFailure } from "../../scripts/lib/ship-gate-failure.mjs";

test("permanent GitHub capability failures are not retryable", () => {
  assert.deepEqual(
    classifyShipGateFailure(new Error("HTTP 403: Upgrade to GitHub Pro to use branch protection on private repositories")),
    {
      classification: "github_capability_or_permission_error",
      retryable: false,
      message: "HTTP 403: Upgrade to GitHub Pro to use branch protection on private repositories",
    },
  );
});

test("transient upstream failures remain retryable", () => {
  assert.deepEqual(classifyShipGateFailure(new Error("HTTP 503: temporarily unavailable")), {
    classification: "transient_upstream_error",
    retryable: true,
    message: "HTTP 503: temporarily unavailable",
  });
});

test("unclassified failures do not invent retryability", () => {
  assert.deepEqual(classifyShipGateFailure(new Error("unexpected parser failure")), {
    classification: "unknown_error",
    retryable: null,
    message: "unexpected parser failure",
  });
});
