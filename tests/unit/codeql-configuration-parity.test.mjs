import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../../.github/workflows/codeql.yml", import.meta.url), "utf8");
const csharpBlock = workflow.slice(workflow.indexOf("  analyze-csharp:"));

test("PR CodeQL always uploads the C# configuration while scoping the manual build", () => {
  assert.match(csharpBlock, /^    if: always\(\)\s*$/m);
  assert.match(csharpBlock, /build-mode:/);
  assert.match(csharpBlock, /\bnone\b/);
  assert.match(csharpBlock, /\bmanual\b/);

  const buildBlock = csharpBlock.slice(csharpBlock.indexOf("      - name: Build C# authority host"));
  assert.match(buildBlock, /needs\.scope\.outputs\.csharp == 'true'/);
  assert.match(csharpBlock, /category: "\/language:csharp"/);
});
