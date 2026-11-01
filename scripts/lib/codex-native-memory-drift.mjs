import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const TARGETS = Object.freeze([
  Object.freeze({
    section: 'features',
    key: 'memories',
    resultKey: 'featureEnabled',
    reason: 'features.memories_not_false',
  }),
  Object.freeze({
    section: 'memories',
    key: 'use_memories',
    resultKey: 'useMemories',
    reason: 'memories.use_memories_not_false',
  }),
  Object.freeze({
    section: 'memories',
    key: 'generate_memories',
    resultKey: 'generateMemories',
    reason: 'memories.generate_memories_not_false',
  }),
]);

function escapeRegex(value) {
  return value.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
}

function sectionHeader(line) {
  const match = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/u);
  return match ? match[1].trim() : null;
}

function splitLines(text) {
  if (typeof text !== 'string') {
    throw new TypeError('configText must be a string');
  }
  const body = text.startsWith('\uFEFF') ? text.slice(1) : text;
  return body.split(/\r?\n/);
}

function findSection(lines, section) {
  const starts = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (sectionHeader(lines[index]) === section) starts.push(index);
  }

  if (starts.length > 1) {
    throw new Error('Duplicate [' + section + '] section');
  }
  if (starts.length === 0) return null;

  const start = starts[0];
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (sectionHeader(lines[index]) !== null) {
      end = index;
      break;
    }
  }
  return { start, end };
}

function inspectBoolean(lines, section, key) {
  const dotted = new RegExp(
    '^\\s*'
      + escapeRegex(section)
      + '\\.'
      + escapeRegex(key)
      + '\\s*=',
    'u',
  );

  for (const line of lines) {
    if (dotted.test(line)) {
      throw new Error(
        'Refusing ambiguous dotted target ' + section + '.' + key,
      );
    }
  }

  const bounds = findSection(lines, section);
  if (!bounds) return null;

  const keyPattern = new RegExp(
    '^\\s*' + escapeRegex(key) + '\\s*=',
    'u',
  );
  const booleanPattern = new RegExp(
    '^\\s*'
      + escapeRegex(key)
      + '\\s*=\\s*(true|false)\\s*(?:#.*)?$',
    'u',
  );

  const values = [];
  for (let index = bounds.start + 1; index < bounds.end; index += 1) {
    if (!keyPattern.test(lines[index])) continue;
    const match = lines[index].match(booleanPattern);
    if (!match) {
      throw new Error(
        '['
          + section
          + '] '
          + key
          + ' must be a boolean when checked by Agent Hub',
      );
    }
    values.push(match[1] === 'true');
  }

  if (values.length > 1) {
    throw new Error('Duplicate [' + section + '] ' + key + ' setting');
  }

  return values.length === 1 ? values[0] : null;
}

function inspectSettings(configText) {
  const lines = splitLines(configText);
  const settings = {};

  for (const target of TARGETS) {
    settings[target.resultKey] = inspectBoolean(
      lines,
      target.section,
      target.key,
    );
  }

  return settings;
}

function hookCommands(hooks, eventName) {
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) {
    return [];
  }

  const eventMap = (
    hooks.hooks
    && typeof hooks.hooks === 'object'
    && !Array.isArray(hooks.hooks)
  )
    ? hooks.hooks
    : hooks;

  const entries = eventMap[eventName];
  if (!Array.isArray(entries)) return [];

  const commands = [];
  for (const entry of entries) {
    const nested = Array.isArray(entry?.hooks) ? entry.hooks : [];
    for (const hook of nested) {
      for (const key of ['command', 'commandWindows']) {
        if (typeof hook?.[key] === 'string') commands.push(hook[key]);
      }
    }
  }
  return commands;
}

function agentHubHookConfigured(hooks) {
  return hookCommands(hooks, 'UserPromptSubmit').some((command) => (
    /memory-engine[\\/]adapters[\\/]codex-hook-cli\.mjs/i.test(command)
  ));
}

export function evaluateCodexNativeMemoryDrift({
  configText,
  hooks,
}) {
  const configured = agentHubHookConfigured(hooks);

  let settings;
  try {
    settings = inspectSettings(configText);
  } catch (error) {
    return {
      applicable: configured,
      ok: configured ? false : true,
      status: configured ? 'invalid_config' : 'not_applicable',
      agentHubHookConfigured: configured,
      settings: null,
      reasons: [],
      ...(configured
        ? { error: error instanceof Error ? error.message : String(error) }
        : {}),
    };
  }

  if (!configured) {
    return {
      applicable: false,
      ok: true,
      status: 'not_applicable',
      agentHubHookConfigured: false,
      settings,
      reasons: [],
    };
  }

  const reasons = TARGETS
    .filter((target) => settings[target.resultKey] !== false)
    .map((target) => target.reason);

  return {
    applicable: true,
    ok: reasons.length === 0,
    status: reasons.length === 0 ? 'isolated' : 'drift_detected',
    agentHubHookConfigured: true,
    settings,
    reasons,
  };
}

async function readOptional(path, fallback) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

export async function readCodexNativeMemoryDrift({ codexHome }) {
  if (typeof codexHome !== 'string' || codexHome.trim().length === 0) {
    throw new TypeError('codexHome must be a non-empty string');
  }

  const home = resolve(codexHome);
  const [configText, hooksText] = await Promise.all([
    readOptional(join(home, 'config.toml'), ''),
    readOptional(join(home, 'hooks.json'), null),
  ]);

  let hooks = null;
  if (hooksText !== null) {
    try {
      hooks = JSON.parse(hooksText);
    } catch (error) {
      return {
        applicable: null,
        ok: false,
        status: 'invalid_hooks_config',
        agentHubHookConfigured: null,
        settings: null,
        reasons: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return evaluateCodexNativeMemoryDrift({
    configText,
    hooks,
  });
}
