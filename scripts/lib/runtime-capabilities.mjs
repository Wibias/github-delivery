function boolean(value) {
  return value === true;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function buildRuntimeCapabilities({
  host = "unknown",
  os = process.platform,
  probes = {},
  declarations = {},
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

  const ghReadable =
    tools.gh && tools.ghAuthenticated && boolean(probes.repoReadableViaGh);
  const ghWritable =
    tools.gh && tools.ghAuthenticated && boolean(probes.headWritableViaGh);
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
        : "unavailable",
    githubWrites: optional.brokeredConnectorWrite
      ? "connector-broker"
      : ghWritable
        ? "gh-broker"
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
  };

  const degraded = unique([
    !tools.node && "node_unavailable",
    !tools.git && "git_unavailable",
    !github.repoReadable && "github_read_unavailable",
    !github.headWritable && "github_write_permission_unavailable",
    github.headWritable &&
      !github.brokerWriteAvailable &&
      "github_write_not_brokered",
    !github.rulesetsReadable && "rulesets_unreadable",
    !github.reviewThreadsReadable && "review_threads_unreadable",
    fallbacks.rateLimits === "unavailable" && "rate_limit_probe_unavailable",
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
    optional,
    fallbacks,
    degraded,
    readyForReadOnly: github.repoReadable && tools.node,
    readyForMutation:
      github.repoReadable && github.brokerWriteAvailable && tools.node,
  };
}
