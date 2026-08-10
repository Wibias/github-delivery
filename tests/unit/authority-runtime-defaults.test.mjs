import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_AUTHORITY_PIPE } from "../../scripts/lib/authority-host-client.mjs";
import {
  authorityRuntimeEnvironment,
  authorityVerifierConfiguration,
} from "../../scripts/lib/mutation-execution-context.mjs";

const localAppData = "C:\\Users\\me\\AppData\\Local";
const standardTrustStore = `${localAppData}\\GitHubDeliveryAuthority\\trust-store.json`;

test("Windows stale processes recover installer-defined authority defaults", () => {
  const observed = [];
  const env = authorityRuntimeEnvironment({
    env: { LOCALAPPDATA: localAppData },
    platform: "win32",
    exists(path) {
      observed.push(path);
      return path === standardTrustStore;
    },
  });

  assert.equal(env.GITHUB_DELIVERY_AUTHORITY_PIPE, DEFAULT_AUTHORITY_PIPE);
  assert.equal(env.GITHUB_DELIVERY_AUTHORITY_TRUST_STORE, standardTrustStore);
  assert.deepEqual(observed, [standardTrustStore]);
});

test("explicit authority environment values override Windows defaults", () => {
  const env = authorityRuntimeEnvironment({
    env: {
      LOCALAPPDATA: localAppData,
      GITHUB_DELIVERY_AUTHORITY_PIPE: "custom-pipe",
      GITHUB_DELIVERY_AUTHORITY_TRUST_STORE: "C:\\custom\\trust.json",
    },
    platform: "win32",
    exists() {
      throw new Error("explicit trust store must not probe the default path");
    },
  });

  assert.equal(env.GITHUB_DELIVERY_AUTHORITY_PIPE, "custom-pipe");
  assert.equal(env.GITHUB_DELIVERY_AUTHORITY_TRUST_STORE, "C:\\custom\\trust.json");
});

test("verifier configuration reads the discovered standard trust store", () => {
  let readPath = null;
  const trustStore = { schemaVersion: 1, keys: [] };
  const result = authorityVerifierConfiguration({
    env: { LOCALAPPDATA: localAppData },
    platform: "win32",
    exists: (path) => path === standardTrustStore,
    readFile(path) {
      readPath = path;
      return JSON.stringify(trustStore);
    },
  });

  assert.equal(readPath, standardTrustStore);
  assert.deepEqual(result, trustStore);
});

test("non-Windows runtimes do not invent authority configuration", () => {
  const env = authorityRuntimeEnvironment({
    env: { LOCALAPPDATA: "/tmp/local" },
    platform: "linux",
    exists() {
      throw new Error("non-Windows must not probe the Windows install path");
    },
  });
  assert.equal(env.GITHUB_DELIVERY_AUTHORITY_PIPE, undefined);
  assert.equal(env.GITHUB_DELIVERY_AUTHORITY_TRUST_STORE, undefined);
});

test("explicit public key prevents standard trust-store discovery", () => {
  const env = authorityRuntimeEnvironment({
    env: {
      LOCALAPPDATA: localAppData,
      GITHUB_DELIVERY_AUTHORITY_PUBLIC_KEY: "legacy-public-key",
    },
    platform: "win32",
    exists() {
      throw new Error("explicit public key must not probe the default trust store");
    },
  });
  assert.equal(env.GITHUB_DELIVERY_AUTHORITY_PUBLIC_KEY, "legacy-public-key");
  assert.equal(env.GITHUB_DELIVERY_AUTHORITY_TRUST_STORE, undefined);
});
