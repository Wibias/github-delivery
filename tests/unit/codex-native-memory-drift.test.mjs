import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  evaluateCodexNativeMemoryDrift,
  readCodexNativeMemoryDrift,
} from '../../scripts/lib/codex-native-memory-drift.mjs';
import {
  runBootstrapDoctor,
  runBootstrapSetup,
} from '../../scripts/lib/bootstrap-maintenance.mjs';
import {
  main as runGitHubDeliveryCli,
} from '../../scripts/github-delivery-cli.mjs';

test('drift guard reports isolated only when Agent Hub is active and all native memory controls are false', () => {
  const result = evaluateCodexNativeMemoryDrift({
    configText: [
      '[features]',
      'memories = false',
      '',
      '[memories]',
      'use_memories = false',
      'generate_memories = false',
      '',
    ].join('\n'),
    hooks: {
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: 'command',
                commandWindows: 'node C:\\repo\\memory-engine\\adapters\\codex-hook-cli.mjs --ignore-memory-env --explicit-memory-requests --hybrid-recall',
              },
            ],
          },
        ],
      },
    },
  });

  assert.deepEqual(result, {
    applicable: true,
    ok: true,
    status: 'isolated',
    agentHubHookConfigured: true,
    settings: {
      featureEnabled: false,
      useMemories: false,
      generateMemories: false,
    },
    reasons: [],
  });
});

test('drift guard fails closed when any native memory control is enabled or missing', () => {
  const result = evaluateCodexNativeMemoryDrift({
    configText: [
      '[features]',
      'memories = true',
      '',
      '[memories]',
      'generate_memories = false',
      '',
    ].join('\n'),
    hooks: {
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: 'command',
                command: 'node /repo/memory-engine/adapters/codex-hook-cli.mjs --ignore-memory-env --explicit-memory-requests --hybrid-recall',
              },
            ],
          },
        ],
      },
    },
  });

  assert.equal(result.applicable, true);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'drift_detected');
  assert.deepEqual(result.settings, {
    featureEnabled: true,
    useMemories: null,
    generateMemories: false,
  });
  assert.deepEqual(result.reasons, [
    'features.memories_not_false',
    'memories.use_memories_not_false',
  ]);
});

test('drift guard is not applicable when Agent Hub recall hook is absent', () => {
  const result = evaluateCodexNativeMemoryDrift({
    configText: '[features]\nmemories = true\n',
    hooks: {
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: 'command',
                command: 'node ./unrelated-hook.mjs',
              },
            ],
          },
        ],
      },
    },
  });

  assert.deepEqual(result, {
    applicable: false,
    ok: true,
    status: 'not_applicable',
    agentHubHookConfigured: false,
    settings: {
      featureEnabled: true,
      useMemories: null,
      generateMemories: null,
    },
    reasons: [],
  });
});

test('read drift guard is read-only and reports malformed managed config as invalid', async () => {
  const root = await mkdtemp(join(tmpdir(), 'github-delivery-memory-drift-'));
  await writeFile(
    join(root, 'config.toml'),
    '[features]\nmemories = "yes"\n',
  );
  await writeFile(
    join(root, 'hooks.json'),
    JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: 'command',
                command: 'node /repo/memory-engine/adapters/codex-hook-cli.mjs --ignore-memory-env --explicit-memory-requests --hybrid-recall',
              },
            ],
          },
        ],
      },
    }),
  );

  const before = await import('node:fs/promises').then(({ readFile }) => (
    readFile(join(root, 'config.toml'), 'utf8')
  ));
  const result = await readCodexNativeMemoryDrift({ codexHome: root });
  const after = await import('node:fs/promises').then(({ readFile }) => (
    readFile(join(root, 'config.toml'), 'utf8')
  ));

  assert.equal(result.applicable, true);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'invalid_config');
  assert.match(result.error, /boolean/i);
  assert.equal(after, before);
});

test('bootstrap setup refuses ready status when Agent Hub is active but native memory drift is detected', async () => {
  const target = resolve('C:/fixture/github-delivery');
  const codexHome = resolve('C:/fixture/.codex');

  const result = await runBootstrapSetup({
    target,
    codexHome,
    output: { write() {} },
    dependencies: {
      discoverInstallations() {
        return [{ valid: true, target }];
      },
      async reconcileStableAuthorityHost() {
        return { changed: false, installed: { installed: false } };
      },
      readActivationReceipt() {
        return { mode: 'hooks', hookTrustVerified: true };
      },
      async readCodexNativeMemoryDrift() {
        return {
          applicable: true,
          ok: false,
          status: 'drift_detected',
          agentHubHookConfigured: true,
          settings: {
            featureEnabled: true,
            useMemories: false,
            generateMemories: false,
          },
          reasons: ['features.memories_not_false'],
        };
      },
    },
  });

  assert.equal(result.status, 'native_memory_drift');
  assert.equal(result.watchdog, 'hooks');
  assert.equal(result.nativeCodexMemory.ok, false);
  assert.equal(result.nativeCodexMemory.status, 'drift_detected');
  assert.match(result.guidance, /native Codex memory/i);
  assert.match(result.guidance, /isolate-native-codex-memory\.mjs/i);
});

test('bootstrap setup remains ready when native Codex memory is isolated', async () => {
  const target = resolve('C:/fixture/github-delivery');
  const codexHome = resolve('C:/fixture/.codex');

  const result = await runBootstrapSetup({
    target,
    codexHome,
    output: { write() {} },
    dependencies: {
      discoverInstallations() {
        return [{ valid: true, target }];
      },
      async reconcileStableAuthorityHost() {
        return { changed: false, installed: { installed: false } };
      },
      readActivationReceipt() {
        return { mode: 'hooks', hookTrustVerified: true };
      },
      async readCodexNativeMemoryDrift() {
        return {
          applicable: true,
          ok: true,
          status: 'isolated',
          agentHubHookConfigured: true,
          settings: {
            featureEnabled: false,
            useMemories: false,
            generateMemories: false,
          },
          reasons: [],
        };
      },
    },
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.nativeCodexMemory.status, 'isolated');
});

test('bootstrap doctor surfaces the same native-memory drift result read-only', async () => {
  const target = resolve('C:/fixture/github-delivery');
  const codexHome = resolve('C:/fixture/.codex');
  const drift = {
    applicable: true,
    ok: false,
    status: 'drift_detected',
    agentHubHookConfigured: true,
    settings: {
      featureEnabled: false,
      useMemories: true,
      generateMemories: false,
    },
    reasons: ['memories.use_memories_not_false'],
  };

  const report = await runBootstrapDoctor({
    target,
    codexHome,
    dependencies: {
      checkBootstrapEnvironment() {
        return { node: true };
      },
      discoverInstallations() {
        return [{ valid: true, target, version: '1.7.1' }];
      },
      readInstalledManifest() {
        return { kind: 'fixture' };
      },
      compareInstalledManifest() {
        return { clean: true, modifications: [] };
      },
      readUserConfig() {
        return {
          source: 'fixture',
          config: { schemaVersion: 1, authorityMode: 'off' },
        };
      },
      readInstalledAuthorityHost() {
        return {
          supported: false,
          installed: false,
          legacy: false,
          version: null,
          sourceCommit: null,
        };
      },
      readActivationReceipt() {
        return { mode: 'hooks', hookTrustVerified: true };
      },
      latestRelease: async () => ({ tag_name: 'v1.7.1' }),
      runtimeVersion() {
        return '1.7.1';
      },
      async readCodexNativeMemoryDrift() {
        return drift;
      },
    },
  });

  assert.deepEqual(report.nativeCodexMemory, drift);
  assert.equal(report.integrity.clean, true);
  assert.equal(report.latest.relation, 'already_current');
});

test('human-readable doctor output makes native-memory drift visible', async () => {
  let text = '';
  const stdout = {
    write(value) {
      text += String(value);
    },
  };

  await runGitHubDeliveryCli(['doctor'], {
    stdout,
    async runBootstrap() {
      return {
        action: 'doctor',
        environment: {
          ok: true,
          node: { ok: true, version: '24.0.0' },
          git: { ok: true },
          gh: { ok: true },
          ghAuth: { ok: true },
        },
        installed: { version: '1.7.1' },
        latest: { version: '1.7.1', relation: 'already_current' },
        integrity: { ok: true, clean: true },
        activation: {
          mode: 'hooks',
          hooksConfigured: true,
          hookTrustVerified: true,
        },
        authorityHost: {},
        nativeCodexMemory: {
          applicable: true,
          ok: false,
          status: 'drift_detected',
          agentHubHookConfigured: true,
          settings: {
            featureEnabled: true,
            useMemories: false,
            generateMemories: false,
          },
          reasons: ['features.memories_not_false'],
        },
      };
    },
  });

  assert.match(text, /Native Codex memory/i);
  assert.match(text, /DRIFT/i);
  assert.match(text, /features\.memories_not_false/);
  assert.match(text, /isolate-native-codex-memory\.mjs/i);
});
