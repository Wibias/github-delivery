import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildDistribution,
  compareDirectories,
  injectSkillMetadata,
} from "../../scripts/lib/distribution.mjs";

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "shipping-github-dist-test-"));
  mkdirSync(join(root, "references"), { recursive: true });
  mkdirSync(join(root, "scripts", "lib"), { recursive: true });
  mkdirSync(join(root, "overrides", "babysit"), { recursive: true });
  mkdirSync(join(root, "tests", "evals"), { recursive: true });
  mkdirSync(join(root, "tests", "unit"), { recursive: true });
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(
    join(root, "SKILL.md"),
    "---\nname: shipping-github\ndescription: Merge and review GitHub pull requests.\n---\n\nRead `references/shared-rules.md`. Run `scripts/ship-gate.mjs`.\n",
  );
  writeFileSync(join(root, "README.md"), "# shipping-github\r\n");
  writeFileSync(join(root, "LICENSE"), "MIT\n");
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "shipping-github", version: "0.1.0", private: true, type: "module", engines: { node: ">=20" } }, null, 2) + "\n",
  );
  writeFileSync(join(root, "references", "shared-rules.md"), "# Rules\r\n");
  writeFileSync(join(root, "scripts", "ship-gate.mjs"), "#!/usr/bin/env node\nconsole.log('ok');\n");
  writeFileSync(join(root, "scripts", "lib", "helper.mjs"), "export const ok = true;\n");
  writeFileSync(join(root, "overrides", "babysit", "SKILL.md"), "redirect\n");
  writeFileSync(join(root, "tests", "evals", "cases.jsonl"), "{\"id\":\"one\"}\n");
  writeFileSync(join(root, "tests", "unit", "ignored.test.mjs"), "throw new Error('exclude');\n");
  writeFileSync(join(root, ".github", "workflows", "ignored.yml"), "name: ignored\n");
  return root;
}

test("injects Agent Skills metadata from package version", () => {
  const source = "---\nname: shipping-github\ndescription: Merge PRs.\n---\n\nBody\n";
  const result = injectSkillMetadata(source, { version: "0.1.0" });
  assert.match(result, /license: MIT/);
  assert.match(result, /compatibility: Requires Node\.js 20\+/);
  assert.match(result, /version: "0\.1\.0"/);
  assert.match(result, /repository: "https:\/\/github\.com\/Wibias\/shipping-github"/);
  assert.equal((result.match(/^---$/gm) || []).length, 2);
});

test("builds only runtime payload and normalizes text", () => {
  const root = fixtureRoot();
  const out = join(root, "artifacts");
  const result = buildDistribution({ root, out, sourceCommit: "a".repeat(40) });

  const paths = result.manifest.files.map((file) => file.path);
  assert.deepEqual(paths, [...paths].sort());
  assert(paths.includes("SKILL.md"));
  assert(paths.includes("tests/evals/cases.jsonl"));
  assert(!paths.includes("tests/unit/ignored.test.mjs"));
  assert(!paths.includes(".github/workflows/ignored.yml"));
  assert.equal(readFileSync(join(out, "shipping-github", "README.md"), "utf8"), "# shipping-github\n");
  assert.match(readFileSync(join(out, "shipping-github", "SKILL.md"), "utf8"), /version: "0\.1\.0"/);
  assert.equal(readFileSync(join(out, "shipping-github-v0.1.0.zip")).subarray(0, 2).toString("hex"), "504b");
  assert.equal(readFileSync(join(out, "shipping-github-v0.1.0.tar.gz")).subarray(0, 2).toString("hex"), "1f8b");
  assert.match(readFileSync(join(out, "SHA256SUMS"), "utf8"), /shipping-github-v0\.1\.0\.zip/);
});

test("fails when a bundled markdown file references a missing runtime resource", () => {
  const root = fixtureRoot();
  writeFileSync(join(root, "references", "shared-rules.md"), "Run `scripts/missing.mjs`.\n");
  assert.throws(
    () => buildDistribution({ root, out: join(root, "out"), sourceCommit: "b".repeat(40) }),
    /missing runtime reference: scripts\/missing\.mjs/,
  );
});

test("two builds from the same commit are byte-identical", () => {
  const root = fixtureRoot();
  const first = join(root, "first");
  const second = join(root, "second");
  buildDistribution({ root, out: first, sourceCommit: "c".repeat(40) });
  buildDistribution({ root, out: second, sourceCommit: "c".repeat(40) });
  assert.deepEqual(compareDirectories(first, second), []);
});
