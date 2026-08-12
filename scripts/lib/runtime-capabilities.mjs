function boolean(value) {
  return value === true;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function watchdogMode(value) {
  const normalized = String(value || "none").toLowerCase();
  return ["hooks", "stream"].includes(normalized) ? normalized : "none";
}

export function buildRuntimeCapabilities({
  host = "unknown",
  os = process.platform,
  probes = {},
  declarations = {},
  activation = null,
  repo = null,
} = {}) {
  const tools = {
    node: boolean(probes.node),
    git: boolean(probes.git),
    gh: boolean(probes.gh),
    ghAuthenticated: boolean(probes.ghAuthenticated),
  };

  const optional = {
    connectorRead: boolean(declarations.connectorRead),
    connectorWrite: boolean(declarations.connectorWrite),
    brokeredConnectorWrite: boolean(declarations.brokeredConnectorWrite),
    composio: boolean(declarations.composio),
    bugbot: boolean(declarations.bugbot),
    subagents: boolean(declarations.subagents),
    reviewTool: boolean(declarations.reviewTool),
  };
  const declaredWatchdog = declarations.progressWatchdog;
  const installedWatchdog = activation?.mode;
  const hasDeclaredWatchdog =
    declaredWatchdog !== undefined && declaredWatchdog !== null && declaredWatchdog !== "";
  const effectiveWatchdog = watchdogMode(hasDeclaredWatchdog ? declaredWatchdog : installedWatchdog);
  const runtime = {
    progressWatchdog: effectiveWatchdog,
    progressWatchdogDegradationReason:
      hasDeclaredWatchdog && effectiveWatchdog === "stream"
        ? null
        : activation?.degradationReason || null,
    progressWatchdogLauncherPath:
      typeof activation?.launcherPath === "string" ? activation.launcherPath : null,
  };
  runtime.progressWatchdogAvailable = runtime.progressWatchdog !== "none";

  const ghReadable =
    tools.gh && tools.ghAuthenticated && boolean(probes.repoReadableViaGh);
  const ghWritable =
    tools.gh && tools.ghAuthenticated && boolean(probes.headWritableViaGh);
  const ghAvailable = tools.gh && tools.ghAuthenticated;
  const repoDetected =
    Boolean(repo) ||
    boolean(probes.repoReadableViaGh) ||
    boolean(probes.headWritableViaGh);
  const repoReadable = optional.connectorRead || ghReadable;
  const headWritable = optional.connectorWrite || ghWritable;
  const brokerWriteAvailable = optional.brokeredConnectorWrite || ghWritable;

  const github = {
    repoReadable,
    headWritable,
    brokerWriteAvailable,
    rulesetsReadable:
      declarations.rulesetsReadable === true ||
      (repoReadable && probes.rulesetsReadableViaGh !== false),
    reviewThreadsReadable:
      declarations.reviewThreadsReadable === true ||
      (repoReadable && probes.reviewThreadsReadableViaGh !== false),
  };

  const fallbacks = {
    githubReads: optional.connectorRead
      ? "connector"
      : ghReadable
        ? "gh"
        : ghAvailable && !repoDetected
          ? "unprobed"
          : "unavailable",
    githubWrites: optional.brokeredConnectorWrite
      ? "connector-broker"
      : ghWritable
        ? "gh-broker"
        : ghAvailable && !repoDetected
          ? "unprobed"
          : "unavailable",
    rateLimits: optional.composio
      ? "composio"
      : tools.gh && tools.ghAuthenticated
        ? "gh"
        : "unavailable",
    bugReview:
      String(host).toLowerCase() === "cursor" && optional.bugbot
        ? "bugbot-plus-complementary"
        : "complementary-lenses",
    standardsReview: optional.reviewTool ? "review-tool" : "in-session",
    parallelism: optional.subagents ? "subagents" : "in-session",
    contextEconomy:
      runtime.progressWatchdog === "stream"
        ? "streaming-watchdog"
        : runtime.progressWatchdog === "hooks"
          ? "lifecycle-hooks"
          : "policy-only",
  };

  const degraded = unique([
    !tools.node && "node_unavailable",
    !tools.git && "git_unavailable",
    !github.repoReadable &&
      !(ghAvailable && !repoDetected) &&
      "github_read_unavailable",
    !github.headWritable &&
      !(ghAvailable && !repoDetected) &&
      "github_write_permission_unavailable",
    ghAvailable && !repoDetected && "github_repo_not_detected",
    github.headWritable &&
      !github.brokerWriteAvailable &&
      "github_write_not_brokered",
    !github.rulesetsReadable && "rulesets_unreadable",
    !github.reviewThreadsReadable && "review_threads_unreadable",
    fallbacks.rateLimits === "unavailable" && "rate_limit_probe_unavailable",
    runtime.progressWatchdog === "none" && "progress_watchdog_unavailable",
  ]);

  return {
    schemaVersion: 1,
    kind: "github-delivery/runtime-capabilities",
    capturedAt: new Date().toISOString(),
    host: String(host || "unknown").toLowerCase(),
    os,
    repo,
    tools,
    github,
    runtime,
    optional,
    fallbacks,
    degraded,
    readyForReadOnly: github.repoReadable && tools.node,
    readyForMutation:
      github.repoReadable && github.brokerWriteAvailable && tools.node,
  };
}
