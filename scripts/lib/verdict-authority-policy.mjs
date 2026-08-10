import { readUserConfig, resolveAuthorityMode } from "./user-config.mjs";

export function verdictAuthorityPolicy({
  offlineFixture = false,
  authorityPublicKeyFile = null,
  env = process.env,
  config = undefined,
  readConfig = readUserConfig,
} = {}) {
  const resolvedConfig =
    config === undefined ? readConfig({ env }).config : config;
  const authorityMode = resolveAuthorityMode({ config: resolvedConfig, env });

  if (offlineFixture && authorityPublicKeyFile) {
    return {
      authorityMode,
      enforceProvenance: true,
      reason: "offline_fixture_explicit_authority_verifier",
    };
  }
  if (offlineFixture) {
    return {
      authorityMode,
      enforceProvenance: false,
      reason: "offline_fixture_provenance_not_checked",
    };
  }
  if (authorityMode === "off") {
    return {
      authorityMode,
      enforceProvenance: false,
      reason: "trusted_authority_disabled_by_user_config",
    };
  }
  return {
    authorityMode,
    enforceProvenance: true,
    reason: "trusted_authority_required_by_user_config",
  };
}
