import assert from "node:assert/strict";
import test from "node:test";

import { buildRuntimeCapabilities } from "../../scripts/lib/runtime-capabilities.mjs";

test("prefers connected capabilities and records safe brokered fallbacks", () => {
  const result = buildRuntimeCapabilities({
    host: "codex",
    os: "win32",
    probes: {
      node: true,
      git: true,
      gh: true,
      ghAuthenticated: true,
      repoReadableViaGh: true,
      headWritableViaGh: true,
    },
    declarations: {
      connectorRead: true,
      connectorWrite: true,
      brokeredConnectorWrite: true,
      composio: true,
      bugbot: false,
      subagents: true,
      reviewTool: true,
    },
  });
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.kind, "github-delivery/runtime-capabilities");
  assert.equal(result.github.repoReadable, true);
  assert.equal(result.github.headWritable, true);
  assert.equal(result.github.brokerWriteAvailable, true);
  assert.equal(result.fallbacks.githubReads, "connector");
  assert.equal(result.fallbacks.githubWrites, "connector-broker");
  assert.equal(result.fallbacks.rateLimits, "composio");
  assert.equal(result.fallbacks.bugReview, "complementary-lenses");
  assert.equal(result.readyForMutation, true);
  assert.deepEqual(result.degraded, []);
});

test("falls back to authenticated gh through the mutation broker", () => {
  const result = buildRuntimeCapabilities({
    host: "claude",
    probes: {
      node: true,
      git: true,
      gh: true,
      ghAuthenticated: true,
      repoReadableViaGh: true,
      headWritableViaGh: true,
    },
    declarations: {},
  });
  assert.equal(result.fallbacks.githubReads, "gh");
  assert.equal(result.fallbacks.githubWrites, "gh-broker");
  assert.equal(result.github.repoReadable, true);
  assert.equal(result.github.headWritable, true);
  assert.equal(result.github.brokerWriteAvailable, true);
  assert.equal(result.readyForMutation, true);
});

test("does not certify a raw connector write without a broker adapter", () => {
  const result = buildRuntimeCapabilities({
    probes: {
      node: true,
      git: true,
      gh: false,
      ghAuthenticated: false,
    },
    declarations: {
      connectorRead: true,
      connectorWrite: true,
      brokeredConnectorWrite: false,
      rulesetsReadable: true,
      reviewThreadsReadable: true,
    },
  });
  assert.equal(result.github.repoReadable, true);
  assert.equal(result.github.headWritable, true);
  assert.equal(result.github.brokerWriteAvailable, false);
  assert.equal(result.fallbacks.githubWrites, "unavailable");
  assert.equal(result.readyForMutation, false);
  assert.ok(result.degraded.includes("github_write_not_brokered"));
});

test("fails closed when no GitHub read path is available", () => {
  const result = buildRuntimeCapabilities({
    probes: { node: true, git: true, gh: false, ghAuthenticated: false },
    declarations: { connectorRead: false, connectorWrite: false },
  });
  assert.equal(result.github.repoReadable, false);
  assert.equal(result.fallbacks.githubReads, "unavailable");
  assert.ok(result.degraded.includes("github_read_unavailable"));
});

test("reports unprobed (not unavailable) when gh is ready but no repo could be detected", () => {
  const result = buildRuntimeCapabilities({
    probes: {
      node: true,
      git: true,
      gh: true,
      ghAuthenticated: true,
      repoReadableViaGh: false,
      headWritableViaGh: false,
    },
    declarations: {},
    repo: null,
  });
  assert.equal(result.github.repoReadable, false);
  assert.equal(result.github.headWritable, false);
  assert.equal(result.fallbacks.githubReads, "unprobed");
  assert.equal(result.fallbacks.githubWrites, "unprobed");
  assert.ok(result.degraded.includes("github_repo_not_detected"));
  assert.ok(!result.degraded.includes("github_read_unavailable"));
  assert.ok(!result.degraded.includes("github_write_permission_unavailable"));
  assert.equal(result.readyForReadOnly, false);
  assert.equal(result.readyForMutation, false);
});

test("still reports unavailable when a repo was detected but permission is missing", () => {
  const result = buildRuntimeCapabilities({
    probes: {
      node: true,
      git: true,
      gh: true,
      ghAuthenticated: true,
      repoReadableViaGh: true,
      headWritableViaGh: false,
    },
    declarations: {},
    repo: "acme/widgets",
  });
  assert.equal(result.fallbacks.githubReads, "gh");
  assert.equal(result.fallbacks.githubWrites, "unavailable");
  assert.ok(result.degraded.includes("github_write_permission_unavailable"));
  assert.ok(!result.degraded.includes("github_repo_not_detected"));
});

test("uses Bugbot only when both host and capability support it", () => {
  const cursor = buildRuntimeCapabilities({
    host: "cursor",
    probes: { node: true },
    declarations: { bugbot: true },
  });
  const codex = buildRuntimeCapabilities({
    host: "codex",
    probes: { node: true },
    declarations: { bugbot: true },
  });
  assert.equal(cursor.fallbacks.bugReview, "bugbot-plus-complementary");
  assert.equal(codex.fallbacks.bugReview, "complementary-lenses");
});
