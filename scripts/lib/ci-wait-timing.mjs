import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_CI_ESTIMATE_MS = 5 * 60 * 1000;
export const DEFAULT_CI_POLL_MS = 30 * 1000;
export const MIN_TIMING_SAMPLES = 3;
export const MAX_TIMING_SAMPLES = 20;

function appIdOf(row = {}) {
  const value = row?.app?.id ?? row?.app?.databaseId ?? row?.app_id ?? null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function keyFor({ repo, context, appId = null } = {}) {
  return JSON.stringify([String(repo || ''), String(context || ''), appId ?? null]);
}

function successfulDuration(row = {}) {
  if (String(row?.status || '').toLowerCase() !== 'completed') return null;
  if (String(row?.conclusion || '').toLowerCase() !== 'success') return null;
  const startedAt = Date.parse(row?.started_at || row?.startedAt || '');
  const completedAt = Date.parse(row?.completed_at || row?.completedAt || '');
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt)) return null;
  const durationMs = completedAt - startedAt;
  return durationMs > 0 ? durationMs : null;
}

function normalizedHistory(history = {}) {
  return {
    schemaVersion: 1,
    entries: history?.entries && typeof history.entries === 'object' ? { ...history.entries } : {},
  };
}

export function recordCompletedChecks(history, { repo, checkRuns = [] } = {}) {
  const next = normalizedHistory(history);
  for (const row of checkRuns || []) {
    const durationMs = successfulDuration(row);
    const context = String(row?.name || '').trim();
    const runId = Number(row?.id);
    if (!durationMs || !context || !Number.isSafeInteger(runId)) continue;
    const appId = appIdOf(row);
    const key = keyFor({ repo, context, appId });
    const existing = next.entries[key] || { repo, context, appId, samples: [] };
    const samples = Array.isArray(existing.samples) ? [...existing.samples] : [];
    if (samples.some((sample) => sample.runId === runId)) continue;
    samples.push({
      runId,
      durationMs,
      completedAt: row?.completed_at || row?.completedAt || null,
    });
    samples.sort((left, right) => {
      const leftTime = Date.parse(left.completedAt || '');
      const rightTime = Date.parse(right.completedAt || '');
      if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return leftTime - rightTime;
      return left.runId - right.runId;
    });
    existing.repo = repo;
    existing.context = context;
    existing.appId = appId;
    existing.samples = samples.slice(-MAX_TIMING_SAMPLES);
    next.entries[key] = existing;
  }
  return next;
}

function percentileNearestRank(values, percentile) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(percentile * sorted.length));
  return sorted[rank - 1];
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

export function estimateCheck(history, { repo, context, appId = null } = {}) {
  const entry = history?.entries?.[keyFor({ repo, context, appId })];
  const values = (entry?.samples || [])
    .map((sample) => Number(sample?.durationMs))
    .filter((value) => Number.isFinite(value) && value > 0)
    .slice(-MAX_TIMING_SAMPLES);
  if (values.length < MIN_TIMING_SAMPLES) {
    return {
      typicalMs: DEFAULT_CI_ESTIMATE_MS,
      usuallyByMs: DEFAULT_CI_ESTIMATE_MS,
      source: 'default',
      sampleCount: values.length,
    };
  }
  return {
    typicalMs: median(values),
    usuallyByMs: percentileNearestRank(values, 0.9),
    source: 'history',
    sampleCount: values.length,
  };
}

export function pendingCheckSummary({ repo, history, checkRuns = [], requiredContexts = [], nowMs = Date.now() } = {}) {
  const required = new Set((requiredContexts || []).map((value) => String(value)));
  const pending = (checkRuns || [])
    .filter((row) => String(row?.status || '').toLowerCase() !== 'completed')
    .filter((row) => required.size === 0 || required.has(String(row?.name || '')))
    .map((row) => {
      const context = String(row?.name || 'unnamed');
      const appId = appIdOf(row);
      const startedAt = Date.parse(row?.started_at || row?.startedAt || '');
      const elapsedMs = Number.isFinite(startedAt) ? Math.max(0, nowMs - startedAt) : null;
      const estimate = estimateCheck(history, { repo, context, appId });
      return {
        context,
        appId,
        elapsedMs,
        estimate,
        exceededEstimate: elapsedMs !== null && elapsedMs > estimate.typicalMs,
      };
    });
  const longestRunning = [...pending].sort((left, right) => (right.elapsedMs ?? -1) - (left.elapsedMs ?? -1))[0] || null;
  return { pendingCount: pending.length, longestRunning, pending };
}

export function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return 'unknown';
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

export function formatWaitStatus(summary = {}, { requiredCount = summary.pendingCount || 0, pollMs = DEFAULT_CI_POLL_MS } = {}) {
  const lines = [`${requiredCount} required check${requiredCount === 1 ? '' : 's'} still pending.`];
  const longest = summary?.longestRunning || null;
  if (longest) {
    const elapsed = longest.elapsedMs === null ? 'start time unavailable' : `${formatDuration(longest.elapsedMs)} elapsed`;
    lines.push(`Longest-running: ${longest.context}, ${elapsed}.`);
    if (longest.estimate?.source === 'history') {
      lines.push(`Typical duration: ${formatDuration(longest.estimate.typicalMs)} from ${longest.estimate.sampleCount} recent runs.`);
      lines.push(`Usually done by: ${formatDuration(longest.estimate.usuallyByMs)}.`);
    } else if (longest.exceededEstimate) {
      lines.push(`Running longer than the ${formatDuration(DEFAULT_CI_ESTIMATE_MS)} default estimate.`);
    } else {
      lines.push(`No timing history yet. Using the ${formatDuration(DEFAULT_CI_ESTIMATE_MS)} default estimate.`);
    }
  }
  lines.push(`Next check in ${formatDuration(pollMs)}.`);
  return lines.join('\n');
}

export async function loadTimingHistory(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

export async function saveTimingHistory(filePath, history) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(history, null, 2)}\n`, 'utf8');
  await rename(tempPath, filePath);
}
