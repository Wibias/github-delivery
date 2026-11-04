import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const policyUrl = new URL("../../references/policy/reviews.md", import.meta.url);

test("review policy preserves comparable always-on cost measurements across skill syncs", () => {
  const policy = readFileSync(policyUrl, "utf8");
  const proactive = policy.split("### GD-REVIEW-008")[1]?.split("### GD-REVIEW-009")[0] ?? "";

  assert.ok(proactive, "expected GD-REVIEW-008 contract");
  assert.match(proactive, /always-on|per-edit|per-request|per-message/i);
  assert.match(proactive, /baseline/i);
  assert.match(proactive, /candidate|branch/i);
  assert.match(proactive, /same measurement method/i);
  assert.match(proactive, /representative inputs/i);
  assert.match(proactive, /p50/i);
  assert.match(proactive, /p95/i);
  assert.match(proactive, /cold.start/i);
  assert.match(proactive, /unproven/i);
});
