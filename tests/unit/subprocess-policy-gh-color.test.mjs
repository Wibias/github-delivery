import assert from "node:assert/strict";
import test from "node:test";

import { boundedSpawnSync } from "../../scripts/lib/subprocess-policy.mjs";

test("all direct gh subprocesses force deterministic colourless output", () => {
  let observed;
  const result = boundedSpawnSync(
    "gh",
    ["pr", "view", "191", "--json", "headRefOid"],
    {
      encoding: "utf8",
      env: {
        PATH: "/usr/bin",
        KEEP_ME: "yes",
        CLICOLOR_FORCE: "1",
        FORCE_COLOR: "3",
        GH_FORCE_TTY: "120",
      },
    },
    {
      platform: "linux",
      spawn(command, args, options) {
        observed = { command, args, options };
        return { status: 0, stdout: "{}", stderr: "" };
      },
    },
  );

  assert.equal(result.status, 0);
  assert.equal(observed.options.env.KEEP_ME, "yes");
  assert.equal(observed.options.env.NO_COLOR, "1");
  assert.equal(observed.options.env.CLICOLOR, "0");
  assert.equal(Object.hasOwn(observed.options.env, "CLICOLOR_FORCE"), false);
  assert.equal(Object.hasOwn(observed.options.env, "FORCE_COLOR"), false);
  assert.equal(Object.hasOwn(observed.options.env, "GH_FORCE_TTY"), false);
});

test("non-gh subprocesses preserve caller colour environment", () => {
  let observed;
  boundedSpawnSync(
    "node",
    ["--version"],
    { env: { PATH: "/usr/bin", FORCE_COLOR: "3" } },
    {
      platform: "linux",
      spawn(command, args, options) {
        observed = options;
        return { status: 0, stdout: "", stderr: "" };
      },
    },
  );
  assert.equal(observed.env.FORCE_COLOR, "3");
});
