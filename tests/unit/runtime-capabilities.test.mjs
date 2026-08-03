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
