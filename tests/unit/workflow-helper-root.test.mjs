import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const foreignCwd = mkdtempSync(join(tmpdir(), "gd-workflow-helper-root-"));

function run(script, args) {
  return spawnSync(process.execPath, [join(repoRoot, "scripts", script), ...args], {
    cwd: foreignCwd,
    encoding: "utf8",
    shell: false,
  });
}

test("policy-bundle resolves the installed skill root when invoked from another repository", () => {
  const result = run("policy-bundle.mjs", ["git-workflow"]);
  assert.equal(result.status, 0, result.stderr);
  const packet = JSON.parse(result.stdout);
  assert.equal(packet.workflow, "git-workflow");
  assert.equal(packet.workflowPath, "references/git-workflow.md");
});

test("workflow-brief resolves the installed skill root when invoked from another repository", () => {
  const result = run("workflow-brief.mjs", ["git-workflow"]);
  assert.equal(result.status, 0, result.stderr);
  const packet = JSON.parse(result.stdout);
  assert.equal(packet.workflow, "git-workflow");
  assert.equal(packet.profile.workflowPath, "references/git-workflow.md");
});
