import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  DEFAULT_CI_ESTIMATE_MS,
  DEFAULT_CI_POLL_MS,
  estimateCheck,
  formatWaitStatus,
  loadTimingHistory,
  pendingCheckSummary,
  recordCompletedChecks,
  saveTimingHistory,
} from '../../scripts/lib/ci-wait-timing.mjs';

test('unknown checks use a five minute estimate and 30 second poll cadence', () => {
  assert.equal(DEFAULT_CI_ESTIMATE_MS, 5 * 60 * 1000);
  assert.equal(DEFAULT_CI_POLL_MS, 30 * 1000);
  assert.deepEqual(
    estimateCheck({}, { repo: 'o/r', context: 'test', appId: 1 }),
    { typicalMs: 300000, usuallyByMs: 300000, source: 'default', sampleCount: 0 },
  );
});

test('three successful samples enable median and p90 learned timing', () => {
  let history = {};
  history = recordCompletedChecks(history, {
    repo: 'o/r',
    checkRuns: [
      completed(1, 'test', 1, 100000),
      completed(2, 'test', 1, 200000),
      completed(3, 'test', 1, 500000),
    ],
  });
  assert.deepEqual(
    estimateCheck(history, { repo: 'o/r', context: 'test', appId: 1 }),
    { typicalMs: 200000, usuallyByMs: 500000, source: 'history', sampleCount: 3 },
  );
});

test('history deduplicates check run ids and retains only twenty recent samples', () => {
  const rows = Array.from({ length: 25 }, (_, index) => completed(index + 1, 'test', 1, 100000 + index * 1000));
  let history = recordCompletedChecks({}, { repo: 'o/r', checkRuns: rows });
  history = recordCompletedChecks(history, { repo: 'o/r', checkRuns: rows.slice(-5) });
  const entry = Object.values(history.entries)[0];
  assert.equal(entry.samples.length, 20);
  assert.deepEqual(entry.samples.map((sample) => sample.runId), Array.from({ length: 20 }, (_, index) => index + 6));
});

test('pending summary selects the actual longest running current check without runner preference', () => {
  const nowMs = Date.parse('2026-08-10T08:10:00Z');
  const checkRuns = [
    pending(10, 'test (windows-latest)', 1, '2026-08-10T08:05:00Z'),
    pending(11, 'test (macos-latest)', 1, '2026-08-10T08:01:00Z'),
  ];
  const summary = pendingCheckSummary({
    repo: 'o/r',
    history: {},
    checkRuns,
    requiredContexts: ['test (windows-latest)', 'test (macos-latest)'],
    nowMs,
  });
  assert.equal(summary.pendingCount, 2);
  assert.equal(summary.longestRunning.context, 'test (macos-latest)');
  assert.equal(summary.longestRunning.elapsedMs, 9 * 60 * 1000);
  assert.equal(summary.longestRunning.exceededEstimate, true);
  assert.equal(summary.longestRunning.estimate.source, 'default');
});

test('corrupt timing history falls back to empty and valid history saves atomically', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gd-ci-wait-'));
  const file = path.join(dir, 'nested', 'history.json');
  await writeFile(path.join(dir, 'corrupt.json'), '{oops', 'utf8');
  assert.deepEqual(await loadTimingHistory(path.join(dir, 'corrupt.json')), {});

  const history = recordCompletedChecks({}, { repo: 'o/r', checkRuns: [completed(1, 'test', 1, 120000)] });
  await saveTimingHistory(file, history);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), history);
});

function completed(id, name, appId, durationMs) {
  const start = Date.parse('2026-08-10T08:00:00Z');
  return {
    id,
    name,
    app: { id: appId },
    status: 'completed',
    conclusion: 'success',
    started_at: new Date(start).toISOString(),
    completed_at: new Date(start + durationMs).toISOString(),
  };
}

function pending(id, name, appId, startedAt) {
  return { id, name, app: { id: appId }, status: 'in_progress', conclusion: null, started_at: startedAt, completed_at: null };
}

test('wait status uses exact current check evidence and the default estimate without inventing a runner', () => {
  const text = formatWaitStatus({
    pendingCount: 1,
    longestRunning: {
      context: 'integration-tests',
      elapsedMs: 400000,
      exceededEstimate: true,
      estimate: { typicalMs: 300000, usuallyByMs: 300000, source: 'default', sampleCount: 0 },
    },
  }, { requiredCount: 1, pollMs: 30000 });
  assert.match(text, /Longest-running: integration-tests, 6m 40s elapsed\./);
  assert.match(text, /Running longer than the 5m default estimate\./);
  assert.match(text, /Next check in 30s\./);
  assert.doesNotMatch(text, /windows|macos|linux/i);
});
