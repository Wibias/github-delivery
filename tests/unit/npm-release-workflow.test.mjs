import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../../.github/workflows/release.yml", import.meta.url),
  "utf8",
).replace(/\r\n?/g, "\n");

function publishJobSource() {
  const marker = "\n  publish:\n";
  const index = workflow.indexOf(marker);
  assert.notEqual(index, -1, "release workflow must contain a publish job");
  return workflow.slice(index + 1);
}

test("npm trusted publishing runs only in the protected tag publish job", () => {
  const publishJob = publishJobSource();
  const beforePublishJob = workflow.slice(0, workflow.indexOf("\n  publish:\n"));

  assert.match(
    publishJob,
    /if: startsWith\(github\.ref, 'refs\/tags\/v'\) && \(github\.event_name == 'push' \|\| github\.event_name == 'workflow_dispatch'\)/,
  );
  assert.match(publishJob, /environment: release/);
  assert.match(publishJob, /id-token: write/);
  assert.doesNotMatch(beforePublishJob, /npm publish/);
  assert.equal(
    (
      workflow.match(
        /node \.github\/npm-publish\/node_modules\/npm\/bin\/npm-cli\.js publish --access public/g,
      ) || []
    ).length,
    1,
    "npm publication must occur exactly once",
  );
});

test("npm trusted publishing uses registry setup and no publish token secret", () => {
  const publishJob = publishJobSource();

  assert.match(
    publishJob,
    /- name: Set up Node\.js[\s\S]*?registry-url: https:\/\/registry\.npmjs\.org/,
  );
  assert.match(
    publishJob,
    /npm ci --prefix \.github\/npm-publish --allow-remote=all --ignore-scripts/,
  );
  assert.match(
    publishJob,
    /npm run package:check[\s\S]*node \.github\/npm-publish\/node_modules\/npm\/bin\/npm-cli\.js publish --access public/,
  );
  assert.doesNotMatch(publishJob, /NPM_TOKEN/);
  assert.doesNotMatch(publishJob, /NODE_AUTH_TOKEN/);
  assert.doesNotMatch(publishJob, /npm publish[^\n]*--provenance/);
});

test("npm publication remains fail-visible in the release sequence", () => {
  const publishJob = publishJobSource();

  assert.match(
    publishJob,
    /Rebuild from the tagged commit[\s\S]*npm run package:check[\s\S]*npm ci --prefix \.github\/npm-publish --allow-remote=all --ignore-scripts[\s\S]*node \.github\/npm-publish\/node_modules\/npm\/bin\/npm-cli\.js publish --access public[\s\S]*Publish GitHub Release/,
  );
  assert.doesNotMatch(publishJob, /npm publish[^\n]*(\|\| true|continue-on-error)/);
});
