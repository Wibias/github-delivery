#!/usr/bin/env node
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { boundedSpawnSync } from './lib/subprocess-policy.mjs';
import { classifyGateForCiWait, waitForCi } from './lib/ci-wait-loop.mjs';
import {
  DEFAULT_CI_POLL_MS,
  formatWaitStatus,
  loadTimingHistory,
  pendingCheckSummary,
  recordCompletedChecks,
  saveTimingHistory,
} from './lib/ci-wait-timing.mjs';

const SHIP_GATE = fileURLToPath(new URL('./ship-gate.mjs', import.meta.url));
const USAGE = 'Usage: node scripts/ci-wait.mjs OWNER/REPO PR_NUMBER [--workflow NAME] [--mutation-mode MODE]';

function parseArgs(argv) {
  const positional = [];
  const options = { workflow: null, mutationMode: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--workflow') options.workflow = argv[++index] || null;
    else if (value === '--mutation-mode') options.mutationMode = argv[++index] || null;
    else positional.push(value);
  }
  const repo = positional[0];
  const pr = Number(positional[1]);
  if (positional.length !== 2 || !repo?.includes('/') || !Number.isInteger(pr) || pr <= 0) throw new Error(USAGE);
  return { repo, pr, ...options };
}

function runGate({ repo, pr, workflow, mutationMode }) {
  const args = [SHIP_GATE, repo, String(pr)];
  if (mutationMode) args.push('--mutation-mode', mutationMode);
  if (workflow) args.push('--workflow', workflow);
  const result = boundedSpawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 });
  let gate;
  try {
    gate = JSON.parse(result.stdout || 'null');
  } catch {
    gate = null;
  }
  if (!gate) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(detail || `ship_gate_failed:exit_${result.status}`);
  }
  return gate;
}

function fetchCheckRuns({ repo, sha }) {
  const result = boundedSpawnSync(
    'gh',
    ['api', `repos/${repo}/commits/${sha}/check-runs?per_page=100`, '--paginate', '--slurp'],
    { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(`ci_wait_check_runs_failed:${detail || `exit_${result.status}`}`);
  }
  const pages = JSON.parse(result.stdout || '[]');
  if (!Array.isArray(pages)) throw new Error('ci_wait_check_runs_invalid_payload');
  const checkRuns = pages.flatMap((page) => (Array.isArray(page?.check_runs) ? page.check_runs : []));
  const expected = pages.reduce((count, page) => {
    const value = Number(page?.total_count);
    return Number.isSafeInteger(value) && value >= 0 ? Math.max(count, value) : count;
  }, 0);
  if (expected !== checkRuns.length) {
    throw new Error(`ci_wait_check_runs_incomplete: expected ${expected}, observed ${checkRuns.length}`);
  }
  return checkRuns;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function statePath() {
  const root = process.env.GITHUB_DELIVERY_STATE_DIR || path.join(homedir(), '.github-delivery');
  return path.join(root, 'ci-wait-history.json');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const historyPath = statePath();
  let history = await loadTimingHistory(historyPath);
  let initialHead = null;

  const result = await waitForCi({
    pollMs: DEFAULT_CI_POLL_MS,
    sleep,
    inspect: async () => {
      const gate = runGate(args);
      if (!initialHead) initialHead = gate.headOid || null;
      const classified = classifyGateForCiWait(gate, { initialHead });
      if (classified.action === 'stop') return classified;

      const sha = gate.authoritativeCheckSha || gate.headOid;
      if (!sha) return { action: 'stop', reason: 'authoritative_check_sha_missing', gate };
      const checkRuns = fetchCheckRuns({ repo: args.repo, sha });
      history = recordCompletedChecks(history, { repo: args.repo, checkRuns });
      try {
        await saveTimingHistory(historyPath, history);
      } catch (error) {
        process.stderr.write(`CI timing history warning: ${String(error?.message || error)}\n`);
      }

      if (classified.action === 'ready') {
        return { ...classified, message: `CI gate ready on ${String(gate.headOid || sha).slice(0, 12)}.` };
      }

      const summary = pendingCheckSummary({
        repo: args.repo,
        history,
        checkRuns,
        requiredContexts: classified.requiredContexts,
      });
      return {
        ...classified,
        summary,
        message: formatWaitStatus(summary, {
          requiredCount: classified.requiredContexts.length,
          pollMs: DEFAULT_CI_POLL_MS,
        }),
      };
    },
    onPoll: async (state) => {
      if (state?.message) process.stdout.write(`${state.message}\n`);
      else if (state?.reason === 'head_changed') process.stdout.write(`PR head moved to ${state.headOid}; restart CI evaluation on the new head.\n`);
      else if (state?.reason === 'gate_unknown') process.stdout.write(`CI wait stopped because the authoritative gate is unknown: ${(state.gate?.unknowns || []).join(', ') || 'unknown evidence'}.\n`);
      else if (state?.reason === 'non_ci_blocker') process.stdout.write(`CI wait stopped because another blocker needs action: ${(state.blockers || []).join(', ') || 'non-CI blocker'}.\n`);
      else if (state?.reason) process.stdout.write(`CI wait stopped: ${state.reason}.\n`);
    },
  });

  if (result.action === 'ready') return;
  process.exitCode = result.reason === 'non_ci_blocker' ? 1 : result.reason === 'head_changed' ? 3 : 2;
}

main().catch((error) => {
  console.error(String(error?.message || error));
  process.exit(2);
});
