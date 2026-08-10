import {
  readUserConfig,
  resolveAuthorityMode,
  writeUserConfig,
} from "./user-config.mjs";

export function parseConfigArgs(argv = []) {
  const options = { show: false, authorityMode: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--show") options.show = true;
    else if (arg === "--authority-mode") {
      options.authorityMode = argv[++index];
      if (!options.authorityMode) throw new Error("--authority-mode requires a value");
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.show && !options.authorityMode) options.show = true;
  return options;
}

export function runConfigCommand({ argv = [], env = process.env, dependencies = {} } = {}) {
  const read = dependencies.readUserConfig || readUserConfig;
  const write = dependencies.writeUserConfig || writeUserConfig;
  const options = parseConfigArgs(argv);
  const current = read({ env });
  let stored = current;
  if (options.authorityMode) {
    stored = write({
      ...current.config,
      authorityMode: String(options.authorityMode).trim().toLowerCase(),
    });
  }
  return {
    schemaVersion: 1,
    kind: "github-delivery/user-configuration",
    path: stored.path,
    source: options.authorityMode ? "updated" : current.source,
    config: stored.config,
    effectiveAuthorityMode: resolveAuthorityMode({ config: stored.config, env }),
  };
}
