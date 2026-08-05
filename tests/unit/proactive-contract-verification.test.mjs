import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
function read(p) {
  return readFileSync(join(root, p), 'utf8');
}

test('shared rules require proactive contract verification before ready claims', () => {
  const s = read('references/shared-rules.md');
  assert.match(s, /find bugs before bots/);
  assert.match(s, /necessary, not sufficient/);
  assert.match(s, /Wiring audit/);
  assert.match(s, /Operator smoke/);
  assert.match(s, /Test honesty/);
  assert.match(s, /Docs vs non-goals/);
  assert.match(s, /Proactive contract verification incomplete/);
});

test('bug-review adds api_cli_wiring must-probe block', () => {
  const b = read('references/bug-review.md');
  assert.match(b, /api_cli_wiring/);
  assert.match(b, /Must probe/);
  assert.match(b, /End-to-end trace/);
  assert.match(b, /Test honesty/);
  assert.match(b, /Adversarial config/);
});

test('spec-standards-review requires docs-vs-non-goals check', () => {
  const s = read('references/spec-standards-review.md');
  assert.match(s, /Docs vs non-goals/);
  assert.match(s, /no production routing yet/);
  assert.match(s, /Proactive contract verification/);
});

test('workflows wire proactive contract verification into create and fix paths', () => {
  assert.match(read('references/create-pr-for-issue.md'), /proactive contract verification/i);
  assert.match(read('references/fix-pr-bots.md'), /Proactive contract verification/);
  assert.match(read('references/pr-description.md'), /Proactive contract verification/);
  assert.match(read('SKILL.md'), /proactive contract verification/i);
});

