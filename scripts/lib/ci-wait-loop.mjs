import { DEFAULT_CI_POLL_MS } from './ci-wait-timing.mjs';

const PENDING_PREFIX = 'requiredChecks:pending:';

export function classifyGateForCiWait(gate = {}, { initialHead = null } = {}) {
  const head = String(gate?.headOid || '');
  if (initialHead && head && head !== initialHead) {
    return { action: 'stop', reason: 'head_changed', headOid: head, gate };
  }
  if (gate?.ready === true) {
    return { action: 'ready', reason: 'gate_ready', headOid: head, gate };
  }
  if (gate?.unknown === true || gate?.decision === 'unknown') {
    return { action: 'stop', reason: 'gate_unknown', headOid: head, gate };
  }
  const blockers = Array.isArray(gate?.blockers) ? gate.blockers : [];
  if (!blockers.length || blockers.some((blocker) => !String(blocker).startsWith(PENDING_PREFIX))) {
    return { action: 'stop', reason: 'non_ci_blocker', headOid: head, blockers, gate };
  }
  const requiredContexts = blockers.map((blocker) => {
    const value = String(blocker).slice(PENDING_PREFIX.length);
    const withApp = value.match(/^(.*)@(\d+)$/);
    return withApp ? withApp[1] : value;
  });
  return {
    action: 'wait',
    reason: 'pending_required_ci',
    headOid: head,
    requiredContexts: [...new Set(requiredContexts)],
    gate,
  };
}

export async function waitForCi({ inspect, sleep, pollMs = DEFAULT_CI_POLL_MS, onPoll = () => {} } = {}) {
  if (typeof inspect !== 'function') throw new Error('ci_wait_inspect_required');
  if (typeof sleep !== 'function') throw new Error('ci_wait_sleep_required');
  while (true) {
    const state = await inspect();
    await onPoll(state);
    if (state?.action !== 'wait') return state;
    await sleep(pollMs);
  }
}
