import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizeMutation,
  extractMutationModeArgs,
  mutationProfile,
} from "../../scripts/lib/mutation-policy.mjs";

test("read-only permits evidence reads but denies GitHub writes", () => {
  const profile = mutationProfile("read-only");
  assert.equal(profile.actions.read_evidence.allowed, true);
  assert.equal(profile.actions.merge_pr.allowed, false);
  assert.equal(profile.actions.post_comment.allowed, false);
});

test("review can publish reviews and resolve bot threads but not human threads", () => {
  const profile = mutationProfile("review");
  assert.equal(profile.actions.post_review.allowed, true);
  assert.equal(profile.actions.resolve_thread.allowed, false);
  assert.equal(profile.actions.resolve_bot_thread.allowed, true);
});

test("maintainer mutations require explicit instruction", () => {
  const denied = authorizeMutation({ mode: "maintainer", action: "merge_pr" });
  const allowed = authorizeMutation({
    mode: "maintainer",
    action: "merge_pr",
    explicitInstruction: true,
  });
  assert.equal(denied.reason, "explicit_instruction_required");
  assert.equal(allowed.allowed, true);
});

test("autonomous mode still requires exact text for human replies", () => {
  const denied = authorizeMutation({
    mode: "autonomous",
    action: "reply_human_thread",
  });
  const allowed = authorizeMutation({
    mode: "autonomous",
    action: "reply_human_thread",
    exactTextConfirmed: true,
  });
  assert.equal(denied.reason, "exact_text_confirmation_required");
  assert.equal(allowed.allowed, true);
});

test("extracts mutation flags without leaking them to another parser", () => {
  const result = extractMutationModeArgs([
    "OWNER/REPO",
    "7",
    "--mutation-mode",
    "maintainer",
    "--explicit",
    "--snapshot",
    "evidence.json",
  ]);
  assert.deepEqual(result, {
    argv: ["OWNER/REPO", "7", "--snapshot", "evidence.json"],
    mode: "maintainer",
    explicitInstruction: true,
    exactTextConfirmed: false,
  });
});
