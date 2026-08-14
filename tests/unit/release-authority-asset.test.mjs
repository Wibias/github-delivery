import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8");

test("release workflow builds, attests, and publishes the Windows authority host asset", () => {
  assert.match(workflow, /authority_host:/);
  assert.match(workflow, /runs-on: windows-latest/);
  assert.match(workflow, /dotnet publish[\s\S]*--runtime win-x64[\s\S]*--self-contained true/);
  assert.match(workflow, /actions\/setup-dotnet@[0-9a-f]{40}[\s\S]*dotnet-version: 8\.0\.x/);
  assert.match(workflow, /build-authority-host-release\.mjs/);
  assert.match(workflow, /github-delivery-authority-\$\{\{ github\.sha \}\}/);
  assert.match(workflow, /actions\/download-artifact@[0-9a-f]{40}/);
  assert.match(workflow, /name: Attest Windows authority host/);
  assert.match(workflow, /subject-path: dist\/authority-host\/github-delivery-authority-v\*\.zip/);
  assert.match(workflow, /gh release create[\s\S]*dist\/authority-host\/github-delivery-authority-v\*\.zip[\s\S]*dist\/authority-host\/github-delivery-authority-v\*\.json/);
});

test("protected publish waits for both validation and authority host build", () => {
  assert.match(workflow, /publish:[\s\S]*needs:\s*\n\s*- validate\s*\n\s*- authority_host/);
});
