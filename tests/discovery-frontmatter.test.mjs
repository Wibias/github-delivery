import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

function description(text) {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---/);
  assert.ok(match, 'frontmatter missing');
  const lines = match[1].split(/\r?\n/);
  const start = lines.findIndex((line) => /^description:\s*[>|]/.test(line));
  assert.notEqual(start, -1, 'description missing');
  const parts = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\S/.test(lines[i])) break;
    parts.push(lines[i].trim());
  }
  return parts.join(' ');
}

const workflowLeak = /\b(?:must|always)\s+(?:run|load|read|execute|call|invoke)\b|(?:scripts\/|references\/)[^\s`]+/i;

test('github-delivery discovery description routes without embedding executable procedure', async () => {
  const desc = description(await readFile(path.join(root, 'SKILL.md'), 'utf8'));
  assert.doesNotMatch(desc, workflowLeak);
  assert.match(desc, /GitHub/i);
  assert.match(desc, /Not for/i);
});

for (const name of ['babysit', 'babysit-pr', 'review-security']) {
  test(`${name} redirect description names the destination without embedding its workflow`, async () => {
    const desc = description(await readFile(path.join(root, 'overrides', name, 'SKILL.md'), 'utf8'));
    assert.match(desc, /github-delivery/i);
    assert.match(desc, /redirect/i);
    assert.doesNotMatch(desc, workflowLeak);
  });
}
