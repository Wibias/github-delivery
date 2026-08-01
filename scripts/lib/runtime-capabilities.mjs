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
    composio: boolean(declarations.composio),
    bugbot: boolean(declarations.bugbot),
    subagents: boolean(declarations.subagents),
    reviewTool: boolean(declarations.reviewTool),
  };

  const repoReadable =
    optional.connectorRead ||
    (tools.gh && tools.ghAuthenticated && boolean(probes.repoReadableViaGh));
  const headWritable =
    optional.connectorWrite ||
    (tools.gh && tools.ghAuthenticated && boolean(probes.headWritableViaGh));

  const github = {
    repoReadable,
    headWritable,
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
      : tools.gh && tools.ghAuthenticated && repoReadable
        ? "gh"
        : "unavailable",
    githubWrites: optional.connectorWrite
      ? "connector"
      : tools.gh && tools.ghAuthenticated && headWritable
        ? "gh"
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
    !github.headWritable && "github_write_unavailable",
    !github.rulesetsReadable && "rulesets_unreadable",
    !github.reviewThreadsReadable && "review_threads_unreadable",
    fallbacks.rateLimits === "unavailable" && "rate_limit_probe_unavailable",
  ]);

  return {
    schemaVersion: 1,
    kind: "shipping-github/runtime-capabilities",
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
    readyForMutation: github.repoReadable && github.headWritable && tools.node,
  };
}
