export function buildAgentTraceEnv(env = process.env) {
  return {
    ...env,
    GITHUB_DELIVERY_DEBUG_TRACE: "1",
  };
}
