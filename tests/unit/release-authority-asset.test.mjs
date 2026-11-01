import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8");
const ciWorkflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
const globalJsonUrl = new URL("../../global.json", import.meta.url);

test("release workflow builds, attests, and publishes the Windows authority host asset", () => {
  assert.match(workflow, /authority_host:/);
  assert.match(workflow, /runs-on: windows-latest/);
  assert.match(workflow, /dotnet publish[\s\S]*--runtime win-x64[\s\S]*--self-contained true/);
  assert.match(workflow, /actions\/setup-dotnet@[0-9a-f]{40}[\s\S]*global-json-file: global\.json/);
  assert.match(workflow, /build-authority-host-release\.mjs/);
  assert.match(workflow, /github-delivery-authority-\$\{\{ github\.sha \}\}/);
  assert.match(workflow, /actions\/download-artifact@[0-9a-f]{40}/);
  assert.match(workflow, /name: Attest Windows authority host/);
  assert.match(workflow, /subject-path: dist\/authority-host\/github-delivery-authority-v\*\.zip/);
  assert.match(
    workflow,
    /assets=\([\s\S]*dist\/authority-host\/github-delivery-authority-v\*\.zip[\s\S]*dist\/authority-host\/github-delivery-authority-v\*\.json[\s\S]*\)[\s\S]*gh release create/,
  );
});

test("authority host builds pin the serviced SDK and reject vulnerable Windows Desktop runtimes", () => {
  assert.equal(existsSync(globalJsonUrl), true, "global.json must pin the repository SDK");
  const globalJson = JSON.parse(readFileSync(globalJsonUrl, "utf8"));
  assert.deepEqual(globalJson, {
    sdk: {
      version: "10.0.403",
      rollForward: "disable",
    },
  });
  assert.match(ciWorkflow, /actions\/setup-dotnet@[0-9a-f]{40}[\s\S]*global-json-file: global\.json/);
  assert.doesNotMatch(workflow, /dotnet-version:\s*8\.0\.x/);
  assert.doesNotMatch(ciWorkflow, /dotnet-version:\s*8\.0\.x/);

  for (const buildWorkflow of [workflow, ciWorkflow]) {
    assert.match(buildWorkflow, /runtimepack\.Microsoft\.NETCore\.App\.Runtime\.win-x64\/8\.0\.33/);
    assert.match(buildWorkflow, /Microsoft\.WindowsDesktop\.App\.Runtime\.win-x64/);
    assert.match(buildWorkflow, /8\.0\.32/);
    assert.match(buildWorkflow, /-lt \[version\]'8\.0\.32'/);
  }
});

test("protected publish waits for both validation and authority host build", () => {
  assert.match(workflow, /publish:[\s\S]*needs:\s*\n\s*- validate\s*\n\s*- authority_host/);
});
