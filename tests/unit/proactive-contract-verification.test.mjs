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
  assert.match(s, /Input shape and evidence semantics/);
  assert.match(s, /Hot-path scale and determinism/);
  assert.match(s, /Malformed-input robustness/);
  assert.match(s, /Recursive\/re-entrant lookups must terminate/);
  assert.match(s, /CLI\/API payload completeness/);
  assert.match(s, /Unknown is not false/);
  assert.match(s, /No unbounded memory/);
  assert.match(s, /Absent vs malformed/);
  assert.match(s, /absence of a positive flag is not proof of absence/);
  assert.match(s, /Aggregate all contributing source records/);
  assert.match(s, /No self-recursion on a resolved target/);
  assert.match(s, /Proactive contract verification incomplete/);
});

test('bug-review adds api_cli_wiring must-probe block', () => {
  const b = read('references/bug-review.md');
  assert.match(b, /api_cli_wiring/);
  assert.match(b, /Must probe/);
  assert.match(b, /End-to-end trace/);
  assert.match(b, /Test honesty/);
  assert.match(b, /Adversarial config/);
  assert.match(b, /input_shape/);
  assert.match(b, /evidence_semantics/);
  assert.match(b, /hot_path_scale/);
  assert.match(b, /determinism_metrics/);
  assert.match(b, /malformed_input_robustness/);
  assert.match(b, /Real request shapes/);
  assert.match(b, /Unknown is not false/);
  assert.match(b, /recursive and re-entrant lookups must terminate/i);
  assert.match(b, /CLI\/API payload completeness/);
  assert.match(b, /aggregate all contributing source records/i);
  assert.match(b, /No self-recursion on a resolved target/);
  assert.match(b, /Incremental paths stay incremental/);
  assert.match(b, /Absent vs malformed/);
});

test('spec-standards-review requires docs-vs-non-goals check', () => {
  const s = read('references/spec-standards-review.md');
  assert.match(s, /Docs vs non-goals/);
  assert.match(s, /no production routing yet/);
  assert.match(s, /Proactive contract verification/);
  assert.match(s, /docs vs implemented behavior/);
});

test('workflows wire proactive contract verification into create and fix paths', () => {
  assert.match(read('references/create-pr-for-issue.md'), /proactive contract verification/i);
  assert.match(read('references/fix-pr-bots.md'), /Proactive contract verification/);
  assert.match(read('references/pr-description.md'), /Proactive contract verification/);
  assert.match(read('SKILL.md'), /proactive contract verification/i);
});
