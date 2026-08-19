import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("security support policy follows the latest stable release instead of a stale minor line", () => {
  const security = read("SECURITY.md");
  assert.match(security, /latest stable release/);
  assert.match(security, /current `main` branch/);
  assert.doesNotMatch(security, /latest `0\.3\.x` release/);
});

test("stack workflow does not hide a PowerShell runtime dependency", () => {
  const stack = read("references/stacked-prs.md");
  assert.match(stack, /PowerShell is \*\*not\*\* a runtime requirement/);
  assert.match(stack, /Linux or macOS/);
  assert.match(stack, /Never interpolate attacker-controlled branch\/ref text/);
  assert.doesNotMatch(stack, /Use PowerShell only\./);
});
