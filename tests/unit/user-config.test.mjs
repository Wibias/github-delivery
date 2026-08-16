import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTHORITY_MODES,
  DEFAULT_USER_CONFIG,
  normalizeUserConfig,
  readUserConfig,
  resolveAuthorityMode,
  userConfigPath,
  writeUserConfig,
} from "../../scripts/lib/user-config.mjs";

test("authority mode schema is exact and defaults to high assurance", () => {
  assert.deepEqual(AUTHORITY_MODES, ["off", "high-assurance", "all"]);
  assert.deepEqual(DEFAULT_USER_CONFIG, {
    schemaVersion: 1,
    authorityMode: "high-assurance",
  });
  assert.deepEqual(normalizeUserConfig({ schemaVersion: 1, authorityMode: "high-assurance" }), {
    schemaVersion: 1,
    authorityMode: "high-assurance",
  });
  assert.throws(
    () => normalizeUserConfig({ schemaVersion: 1, authorityMode: "sometimes" }),
    /github_delivery_config_authority_mode_invalid/,
  );
  assert.throws(
    () => normalizeUserConfig({ schemaVersion: 2, authorityMode: "off" }),
    /github_delivery_config_schema_version_unsupported/,
  );
});

test("config path is outside the skill install and follows each OS convention", () => {
  assert.equal(
    userConfigPath({
      platform: "win32",
      env: { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" },
      home: "C:\\Users\\me",
    }),
    "C:\\Users\\me\\AppData\\Local\\github-delivery\\config.json",
  );
  assert.equal(
    userConfigPath({ platform: "darwin", env: {}, home: "/Users/me" }),
    "/Users/me/Library/Application Support/github-delivery/config.json",
  );
  assert.equal(
    userConfigPath({
      platform: "linux",
      env: { XDG_CONFIG_HOME: "/tmp/config" },
      home: "/home/me",
    }),
    "/tmp/config/github-delivery/config.json",
  );
  assert.equal(
    userConfigPath({ platform: "linux", env: {}, home: "/home/me" }),
    "/home/me/.config/github-delivery/config.json",
  );
});

test("missing config is a non-writing secure-default state", () => {
  let read = false;
  const result = readUserConfig({
    path: "/tmp/github-delivery/config.json",
    exists() {
      return false;
    },
    readFile() {
      read = true;
      throw new Error("must not read missing config");
    },
  });
  assert.equal(read, false);
  assert.equal(result.source, "default");
  assert.equal(result.path, "/tmp/github-delivery/config.json");
  assert.deepEqual(result.config, DEFAULT_USER_CONFIG);
  assert.equal(result.config.authorityMode, "high-assurance");
});

test("existing config is parsed and invalid JSON fails closed", () => {
  const valid = readUserConfig({
    path: "/tmp/github-delivery/config.json",
    exists: () => true,
    readFile: () => '{"schemaVersion":1,"authorityMode":"all"}',
  });
  assert.equal(valid.source, "file");
  assert.equal(valid.config.authorityMode, "all");

  assert.throws(
    () => readUserConfig({
      path: "/tmp/github-delivery/config.json",
      exists: () => true,
      readFile: () => "{not-json",
    }),
    /github_delivery_config_invalid_json/,
  );
});

test("config writes atomically and normalizes before replacing the target", () => {
  const calls = [];
  const result = writeUserConfig(
    { schemaVersion: 1, authorityMode: "high-assurance" },
    {
      path: "/tmp/github-delivery/config.json",
      mkdir(path, options) {
        calls.push(["mkdir", path, options]);
      },
      writeFile(path, body, options) {
        calls.push(["write", path, body, options]);
      },
      rename(from, to) {
        calls.push(["rename", from, to]);
      },
      chmod(path, mode) {
        calls.push(["chmod", path, mode]);
      },
      platform: "linux",
      randomSuffix: "unit",
    },
  );

  assert.equal(result.config.authorityMode, "high-assurance");
  assert.equal(result.path, "/tmp/github-delivery/config.json");
  assert.equal(calls[0][0], "mkdir");
  assert.equal(calls[1][0], "write");
  assert.match(calls[1][1], /config\.json\.unit\.tmp$/);
  assert.match(calls[1][2], /"authorityMode": "high-assurance"/);
  assert.deepEqual(calls[2], [
    "rename",
    "/tmp/github-delivery/config.json.unit.tmp",
    "/tmp/github-delivery/config.json",
  ]);
  assert.deepEqual(calls[3], ["chmod", "/tmp/github-delivery/config.json", 0o600]);
});

test("authority mode resolution honors strict legacy and explicit env precedence", () => {
  assert.equal(
    resolveAuthorityMode({
      config: { schemaVersion: 1, authorityMode: "off" },
      env: { GITHUB_DELIVERY_REQUIRE_TRUSTED_AUTHORITY: "1" },
    }),
    "all",
  );
  assert.equal(
    resolveAuthorityMode({
      config: { schemaVersion: 1, authorityMode: "off" },
      env: { GITHUB_DELIVERY_AUTHORITY_MODE: "high-assurance" },
    }),
    "high-assurance",
  );
  assert.equal(
    resolveAuthorityMode({
      config: { schemaVersion: 1, authorityMode: "all" },
      env: {},
    }),
    "all",
  );
  assert.throws(
    () => resolveAuthorityMode({
      config: { schemaVersion: 1, authorityMode: "off" },
      env: { GITHUB_DELIVERY_AUTHORITY_MODE: "sometimes" },
    }),
    /github_delivery_authority_mode_invalid/,
  );
});
