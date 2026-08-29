import assert from "node:assert/strict";
import test from "node:test";

import { createGitHubReleaseClient } from "../../scripts/lib/release-self-update.mjs";

const ASSET = {
  name: "file.zip",
  browser_download_url: "https://objects.example/file.zip",
};

test("asset downloads retry bounded transient gateway failures", async () => {
  let calls = 0;
  const delays = [];
  const client = createGitHubReleaseClient({
    async fetchImpl() {
      calls += 1;
      if (calls < 3) return new Response("gateway timeout", { status: 504 });
      return new Response("verified payload", { status: 200 });
    },
    async sleepImpl(delayMs) {
      delays.push(delayMs);
    },
  });

  const body = await client.downloadAsset(ASSET, 1024);
  assert.equal(body.toString("utf8"), "verified payload");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [250, 750]);
});

test("asset downloads stop after the bounded transient retry budget", async () => {
  let calls = 0;
  const delays = [];
  const client = createGitHubReleaseClient({
    async fetchImpl() {
      calls += 1;
      return new Response("service unavailable", { status: 503 });
    },
    async sleepImpl(delayMs) {
      delays.push(delayMs);
    },
  });

  await assert.rejects(
    () => client.downloadAsset(ASSET, 1024),
    /stable_release_download_failed: HTTP 503/,
  );
  assert.equal(calls, 3);
  assert.deepEqual(delays, [250, 750]);
});

test("asset downloads do not retry deterministic client errors", async () => {
  let calls = 0;
  const delays = [];
  const client = createGitHubReleaseClient({
    async fetchImpl() {
      calls += 1;
      return new Response("not found", { status: 404 });
    },
    async sleepImpl(delayMs) {
      delays.push(delayMs);
    },
  });

  await assert.rejects(
    () => client.downloadAsset(ASSET, 1024),
    /stable_release_download_failed: HTTP 404/,
  );
  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
});
