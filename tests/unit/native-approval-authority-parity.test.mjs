import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("Node and Windows authority canonicalizers reserve approval for approve_pr", () => {
  const nodeEvents = read("scripts/lib/review-event.mjs");
  const nodeScope = read("scripts/lib/authority-scope.mjs");
  const windows = read("authority-host/windows/GitHubDeliveryAuthority/ScopeCanonicalizer.cs");

  assert.match(nodeEvents, /\["comment", "request-changes"\]/);
  assert.doesNotMatch(nodeEvents, /"approve"/);
  assert.match(nodeScope, /case "approve_pr"/);
  assert.match(windows, /case "approve_pr"/);
  assert.match(windows, /eventName is not \("comment" or "request-changes"\)/);
});
