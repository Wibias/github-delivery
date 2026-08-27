import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("Node and Windows authority canonicalizers both accept native approve reviews", () => {
  const node = read("scripts/lib/review-event.mjs");
  const windows = read("authority-host/windows/GitHubDeliveryAuthority/ScopeCanonicalizer.cs");

  assert.match(node, /\["approve", "comment", "request-changes"\]/);
  assert.match(windows, /eventName is not \("approve" or "comment" or "request-changes"\)/);
  assert.doesNotMatch(windows, /review_event_approve_forbidden/);
});
