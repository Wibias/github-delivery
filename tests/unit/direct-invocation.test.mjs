import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { isDirectInvocation } from "../../scripts/lib/direct-invocation.mjs";

test("direct invocation accepts an installed path that canonicalizes to the module target", () => {
  const modulePath = "/checkout/github-delivery/scripts/pre-open-gate.mjs";
  const installedPath = "/home/user/.agents/skills/github-delivery/scripts/pre-open-gate.mjs";
  const realpath = (value) => (value === installedPath ? modulePath : value);

  assert.equal(
    isDirectInvocation(pathToFileURL(modulePath).href, installedPath, { realpath }),
    true,
  );
});

test("direct invocation rejects a genuinely different entry file", () => {
  assert.equal(
    isDirectInvocation(
      pathToFileURL("/checkout/github-delivery/scripts/pre-open-gate.mjs").href,
      "/tmp/importer.mjs",
      { realpath: (value) => value },
    ),
    false,
  );
});
