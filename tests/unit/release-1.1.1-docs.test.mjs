import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("1.1.1 release metadata stays aligned", () => {
  const pkg = JSON.parse(read("package.json"));
  const changelog = read("CHANGELOG.md");
  const readme = read("README.md");

  assert.equal(pkg.version, "1.1.1");
  assert.match(changelog, /## \[1\.1\.1\] - 2026-08-27/);
  assert.match(changelog, /PR #372/);
  assert.match(changelog, /PR #373/);
  assert.match(changelog, /PR #374/);
  assert.match(readme, /> \*\*1\.1\.1\.\*\*/);
  assert.match(readme, /approve PR #42/);
});
