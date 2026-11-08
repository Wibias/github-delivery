import {
  resolveCiEvidenceMode,
  readUserConfig,
  resolveAuthorityMode,
  withCiEvidenceRepository,
  writeUserConfig,
} from "./user-config.mjs";

export function parseConfigArgs(argv = []) {
  const options = {
    show: false,
    authorityMode: null,
    ciEvidenceMode: null,
    repository: null,
    waiver: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--show") options.show = true;
    else if (arg === "--authority-mode") {
      options.authorityMode = argv[++index];
      if (!options.authorityMode) throw new Error("--authority-mode requires a value");
    } else if (arg === "--ci-evidence-mode") {
      options.ciEvidenceMode = argv[++index];
      if (!options.ciEvidenceMode) throw new Error("--ci-evidence-mode requires a value");
    } else if (arg === "--repository") {
      options.repository = argv[++index];
      if (!options.repository) throw new Error("--repository requires a value");
    } else if (arg === "--waiver") {
      options.waiver = argv[++index];
      if (!options.waiver) throw new Error("--waiver requires a value");
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (options.ciEvidenceMode && !options.repository) {
    throw new Error("--ci-evidence-mode requires --repository OWNER/REPO");
  }
  if (!options.show && !options.authorityMode && !options.ciEvidenceMode) {
    options.show = true;
  }
  return options;
}

export function runConfigCommand({ argv = [], env = process.env, dependencies = {} } = {}) {
  const read = dependencies.readUserConfig || readUserConfig;
  const write = dependencies.writeUserConfig || writeUserConfig;
  const options = parseConfigArgs(argv);
  const current = read({ env });
  let stored = current;
  if (options.authorityMode || options.ciEvidenceMode) {
    let next = current.config;
    if (options.authorityMode) {
      next = {
        ...next,
        authorityMode: String(options.authorityMode).trim().toLowerCase(),
      };
    }
    if (options.ciEvidenceMode) {
      next = withCiEvidenceRepository(next, {
        repository: options.repository,
        mode: String(options.ciEvidenceMode).trim().toLowerCase(),
        waiver: options.waiver,
      });
    }
    stored = write(next);
  }
  return {
    schemaVersion: 1,
    kind: "github-delivery/user-configuration",
    path: stored.path,
    source: options.authorityMode || options.ciEvidenceMode ? "updated" : current.source,
    config: stored.config,
    effectiveAuthorityMode: resolveAuthorityMode({ config: stored.config, env }),
    effectiveCiEvidenceMode: options.repository
      ? resolveCiEvidenceMode({ config: stored.config, repo: options.repository }).mode
      : null,
  };
}
