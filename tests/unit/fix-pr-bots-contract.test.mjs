import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

test("shared rules forbid deferring in-scope bot fixes to another PR", () => {
  const sharedRules = read("references/shared-rules.md");
  assert.match(sharedRules, /### Bot-thread ownership \(no false deferral\)/);
  assert.match(sharedRules, /inherited \/ copied \/ fabric file — fix in another PR/);
  assert.match(sharedRules, /rebase \/ stack \/ downstream branch will pick it up/);
  assert.match(sharedRules, /consumer lives elsewhere/);
  assert.match(sharedRules, /non-blocking/);
  assert.match(sharedRules, /Fix-or-decline sequence/);
  assert.match(sharedRules, /`review` may reply to bot threads but \*\*must not\*\* call `resolve_thread`/);
});

test("fix-pr-bots requires verify-fix-resolve and blocks defer-only merge-ready", () => {
  const fixPrBots = read("references/fix-pr-bots.md");
  assert.match(fixPrBots, /Bot-thread triage \(mandatory before any resolve\)/);
  assert.match(fixPrBots, /inherited\/fabric file — fix in another PR/);
  assert.match(fixPrBots, /Fix order:/);
  assert.match(fixPrBots, /defer-to-another-PR \/ fabric-rebase excuse/);
});

test("SKILL hard rules encode bot defer and resolve guardrails", () => {
  const skill = read("SKILL.md");
  assert.match(skill, /Bot threads on paths in this PR diff must be fixed here/);
  assert.match(skill, /never defer with `\[GD\]` \+ resolve to another PR\/rebase/);
  assert.match(skill, /Never resolve a bot thread with only a defer\/skip reply/);
});
