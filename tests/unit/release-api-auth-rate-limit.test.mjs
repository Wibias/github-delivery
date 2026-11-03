import assert from "node:assert/strict";
import test from "node:test";

import { createGitHubReleaseClient } from "../../scripts/lib/release-self-update.mjs";

const REPO_API = "https://api.github.com/repos/Wibias/github-delivery";

function jsonResponse(value, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function release() {
  return { tag_name: "v1.8.2", draft: false, prerelease: false, assets: [] };
}

test("release API supports GH_TOKEN, GITHUB_TOKEN fallback, and anonymous access", async () => {
  for (const [env, expected] of [
    [{}, undefined],
    [{ GITHUB_TOKEN: "fallback_token" }, "Bearer fallback_token"],
    [{ GH_TOKEN: "preferred_token", GITHUB_TOKEN: "fallback_token" }, "Bearer preferred_token"],
  ]) {
    const calls = [];
    const client = createGitHubReleaseClient({
      env,
      async fetchImpl(url, options) {
        calls.push({ url: String(url), options });
        if (String(url).endsWith("/releases/latest")) return jsonResponse(release());
        return jsonResponse({ object: { type: "commit", sha: "a".repeat(40) } });
      },
    });
    assert.equal((await client.latestRelease()).tag_name, "v1.8.2");
    assert.equal(await client.resolveTagCommit("v1.8.2"), "a".repeat(40));
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, `${REPO_API}/releases/latest`);
    assert.equal(calls[1].url, `${REPO_API}/git/ref/tags/v1.8.2`);
    for (const { options } of calls) {
      assert.equal(options.redirect, "manual");
      assert.equal(options.headers.Authorization, expected);
      assert.equal(options.headers["User-Agent"], "github-delivery-release-self-update");
    }
  }
});

test("release assets and their redirect destinations never receive API Authorization", async () => {
  const calls = [];
  const client = createGitHubReleaseClient({
    env: { GH_TOKEN: "secret_test_token" },
    async fetchImpl(url, options) {
      calls.push({ url: String(url), options });
      if (calls.length === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://objects.example/asset.zip" },
        });
      }
      return new Response("zip-bytes", { status: 200 });
    },
  });
  const asset = await client.downloadAsset({
    name: "asset.zip",
    browser_download_url: "https://github.com/Wibias/github-delivery/releases/download/v1.8.2/asset.zip",
  }, 1024);
  assert.equal(asset.toString(), "zip-bytes");
  assert.equal(calls.length, 2);
  for (const { options } of calls) {
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.headers.authorization, undefined);
    assert.equal(options.redirect, "manual");
  }
});

test("primary rate-limit 403 includes a safe UTC reset time and actionable token hint", async () => {
  const client = createGitHubReleaseClient({
    env: {},
    fetchImpl: async () => jsonResponse({ message: "API rate limit exceeded" }, {
      status: 403,
      headers: {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "1793750161",
      },
    }),
  });
  await assert.rejects(() => client.latestRelease(), (error) => {
    assert.match(error.message, /^stable_release_rate_limited:/);
    assert.match(error.message, /HTTP 403/);
    assert.match(error.message, /2026-11-03T23:56:01\.000Z/);
    assert.match(error.message, /GH_TOKEN|GITHUB_TOKEN/);
    return true;
  });
});

test("secondary rate-limit 403 and 429 expose bounded Retry-After guidance", async () => {
  for (const status of [403, 429]) {
    const client = createGitHubReleaseClient({
      env: { GITHUB_TOKEN: "secret_test_token" },
      fetchImpl: async () => jsonResponse({ message: "rate limit" }, {
        status,
        headers: { "retry-after": "60" },
      }),
    });
    await assert.rejects(() => client.latestRelease(), (error) => {
      assert.match(error.message, /stable_release_rate_limited:/);
      assert.match(error.message, /retry_after_seconds=60/);
      assert.doesNotMatch(error.message, /secret_test_token/);
      return true;
    });
  }
});

test("unrelated 403 remains a metadata failure; raw response bodies cannot leak tokens", async () => {
  const client = createGitHubReleaseClient({
    env: { GH_TOKEN: "secret_test_token" },
    fetchImpl: async () => jsonResponse({
      message: "forbidden secret_test_token",
    }, { status: 403 }),
  });
  await assert.rejects(() => client.latestRelease(), (error) => {
    assert.match(error.message, /stable_release_metadata_invalid: HTTP 403/);
    assert.doesNotMatch(error.message, /secret_test_token/);
    return true;
  });
});

test("untrusted rate-limit reset header and transport errors cannot leak credentials", async () => {
  const token = "secret_test_token";
  const invalidReset = createGitHubReleaseClient({
    env: { GH_TOKEN: token },
    fetchImpl: async () => jsonResponse({ message: token }, {
      status: 403,
      headers: {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": token,
      },
    }),
  });
  await assert.rejects(() => invalidReset.latestRelease(), (error) => {
    assert.match(error.message, /stable_release_rate_limited:/);
    assert.doesNotMatch(error.message, new RegExp(token));
    return true;
  });

  const thrown = createGitHubReleaseClient({
    env: { GH_TOKEN: token },
    fetchImpl: async () => { throw new Error(`fetch failed: ${token}`); },
  });
  await assert.rejects(() => thrown.latestRelease(), (error) => {
    assert.match(error.message, /stable_release_metadata_invalid/);
    assert.doesNotMatch(error.message, new RegExp(token));
    return true;
  });
});

test("invalid token cannot reach fetch or appear in errors", async () => {
  let calls = 0;
  const client = createGitHubReleaseClient({
    env: { GH_TOKEN: "bad\r\nHeader: injected" },
    fetchImpl: async () => { calls += 1; return jsonResponse(release()); },
  });
  await assert.rejects(() => client.latestRelease(), (error) => {
    assert.match(error.message, /stable_release_token_invalid/);
    assert.doesNotMatch(error.message, /injected/);
    return true;
  });
  assert.equal(calls, 0);
});
