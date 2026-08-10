import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function text(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

test('CI policy defines adaptive waiting without treating five minutes as a timeout', async () => {
  const ciPolicy = await text('references/policy/ci.md');
  assert.match(ciPolicy, /GD-CI-009/);
  assert.match(ciPolicy, /5 minutes/);
  assert.match(ciPolicy, /30 seconds/);
  assert.match(ciPolicy, /not a timeout/i);
  assert.match(ciPolicy, /current GitHub evidence/i);
});

test('watch and merge workflows use ci-wait and do not hard-code Windows duration', async () => {
  const [watchPr, mergePr] = await Promise.all([
    text('references/watch-pr.md'),
    text('references/merge-pr.md'),
  ]);
  assert.doesNotMatch(watchPr, /windows-latest[^\n]{0,160}(?:12|13|15)/i);
  assert.match(watchPr, /ci-wait\.mjs/);
  assert.match(mergePr, /ci-wait\.mjs/);
});
