import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_CI_POLL_MS } from '../../scripts/lib/ci-wait-timing.mjs';
import { classifyGateForCiWait, waitForCi } from '../../scripts/lib/ci-wait-loop.mjs';

test('wait loop polls every thirty seconds until ready', async () => {
  const states = [{ action: 'wait' }, { action: 'wait' }, { action: 'ready' }];
  const sleeps = [];
  const seen = [];
  const result = await waitForCi({
    inspect: async () => states.shift(),
    sleep: async (ms) => sleeps.push(ms),
    onPoll: (state) => seen.push(state.action),
  });
  assert.equal(result.action, 'ready');
  assert.deepEqual(sleeps, [DEFAULT_CI_POLL_MS, DEFAULT_CI_POLL_MS]);
  assert.deepEqual(seen, ['wait', 'wait', 'ready']);
});

test('wait loop has no fixed five minute or iteration cutoff', async () => {
  let polls = 0;
  const sleeps = [];
  const result = await waitForCi({
    inspect: async () => ({ action: ++polls <= 25 ? 'wait' : 'ready' }),
    sleep: async (ms) => sleeps.push(ms),
  });
  assert.equal(result.action, 'ready');
  assert.equal(polls, 26);
  assert.equal(sleeps.length, 25);
  assert.ok(sleeps.every((ms) => ms === 30000));
});

test('gate classification waits only when every blocker is pending required CI', () => {
  const state = classifyGateForCiWait({
    ready: false,
    unknown: false,
    blocked: true,
    headOid: 'abc',
    blockers: [
      'requiredChecks:pending:test (macos-latest)',
      'requiredChecks:pending:lint@15368',
    ],
  }, { initialHead: 'abc' });
  assert.equal(state.action, 'wait');
  assert.deepEqual(state.requiredContexts, ['test (macos-latest)', 'lint']);
});

test('gate classification stops on non-CI blocker, unknown evidence, or moved head', () => {
  assert.equal(classifyGateForCiWait({ ready: false, unknown: false, blocked: true, headOid: 'abc', blockers: ['baseHealth:pr_failure'] }, { initialHead: 'abc' }).reason, 'non_ci_blocker');
  assert.equal(classifyGateForCiWait({ ready: false, unknown: true, blocked: false, headOid: 'abc', blockers: [] }, { initialHead: 'abc' }).reason, 'gate_unknown');
  assert.equal(classifyGateForCiWait({ ready: false, unknown: false, blocked: true, headOid: 'def', blockers: ['requiredChecks:pending:test'] }, { initialHead: 'abc' }).reason, 'head_changed');
});
