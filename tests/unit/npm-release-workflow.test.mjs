import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../../.github/workflows/release.yml", import.meta.url),
  "utf8",
).replace(/\r\n?/g, "\n");
const publisher = readFileSync(
  new URL("../../scripts/publish-npm-idempotent.mjs", import.meta.url),
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
  assert.doesNotMatch(beforePublishJob, /publish-npm-idempotent|npm publish|npm-cli\.js publish/);
  assert.equal(
    (workflow.match(/node scripts\/publish-npm-idempotent\.mjs/g) || []).length,
    1,
    "npm publication entrypoint must occur exactly once",
  );
  assert.match(
    publisher,
    /run\(npmCli, \["publish", "--access", "public", "--ignore-scripts"\]\)/,
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
    /npm ci --prefix \.github\/npm-publish --include=dev --allow-remote=all --ignore-scripts/,
  );
  assert.match(
    publishJob,
    /npm run package:check[\s\S]*node scripts\/publish-npm-idempotent\.mjs/,
  );
  assert.doesNotMatch(workflow, /NPM_TOKEN/);
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN/);
  assert.doesNotMatch(publisher, /--provenance/);
});

test("npm publication remains fail-visible and resumable after GitHub publication", () => {
  const publishJob = publishJobSource();

  assert.match(
    publishJob,
    /Rebuild from the tagged commit[\s\S]*npm run package:check[\s\S]*Install trusted-publishing npm CLI[\s\S]*Publish or verify GitHub Release[\s\S]*Publish or verify npm package/,
  );
  assert.doesNotMatch(publishJob, /continue-on-error|\|\| true/);
  const existingCheck = publisher.indexOf("const existingIntegrity = publishedPackageIntegrity");
  const publishCall = publisher.indexOf('run(npmCli, ["publish", "--access", "public", "--ignore-scripts"]);');
  assert.ok(existingCheck >= 0, "publisher must inspect an existing package version");
  assert.ok(publishCall > existingCheck, "publisher must verify/reuse before attempting publish");
  assert.match(publisher, /npm_existing_version_integrity_mismatch/);
  assert.match(publisher, /npm_publish_verification_failed/);
});
