import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const workflowBrief = join(repoRoot, "scripts", "workflow-brief.mjs");
const controller = join(repoRoot, "scripts", "delivery-controller.mjs");
const HEAD = "a".repeat(40);
const NEXT_HEAD = "b".repeat(40);

function run(script, args, stateDir) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    env: { ...process.env, GITHUB_DELIVERY_STATE_DIR: stateDir },
    encoding: "utf8",
    shell: false,
  });
}

function bootstrap(stateDir, head = HEAD) {
  return run(
    workflowBrief,
    ["create-pr-from-local-work", "--repo", "Wibias/example", "--head", head],
    stateDir,
  );
}

test("local PR workflow brief creates and resumes one deterministic head-bound checkpoint", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "gd-local-pr-bootstrap-"));

  const first = bootstrap(stateDir);
  assert.equal(first.status, 0, first.stderr);
  const firstPacket = JSON.parse(first.stdout);
  assert.equal(firstPacket.workflow, "create-pr-from-local-work");
  assert.equal(firstPacket.controller.reused, false);
  assert.equal(firstPacket.controller.snapshot.repo, "Wibias/example");
  assert.equal(firstPacket.controller.snapshot.headSha, HEAD);
  assert.equal(firstPacket.controller.snapshot.phase, "ROUTE");
  assert.match(firstPacket.controller.checkpointPath, /workflow-checkpoints[/\\][0-9a-f]{64}\.json$/i);

  const saved = JSON.parse(readFileSync(firstPacket.controller.checkpointPath, "utf8"));
  assert.equal(saved.headSha, HEAD);

  const advanced = run(
    controller,
    ["transition", firstPacket.controller.checkpointPath, "PREFLIGHT"],
    stateDir,
  );
  assert.equal(advanced.status, 0, advanced.stderr);

  const second = bootstrap(stateDir);
  assert.equal(second.status, 0, second.stderr);
  const secondPacket = JSON.parse(second.stdout);
  assert.equal(secondPacket.controller.reused, true);
  assert.equal(secondPacket.controller.checkpointPath, firstPacket.controller.checkpointPath);
  assert.equal(secondPacket.controller.snapshot.phase, "PREFLIGHT");

  const differentHead = bootstrap(stateDir, NEXT_HEAD);
  assert.equal(differentHead.status, 0, differentHead.stderr);
  const differentPacket = JSON.parse(differentHead.stdout);
  assert.equal(differentPacket.controller.reused, false);
  assert.notEqual(differentPacket.controller.checkpointPath, firstPacket.controller.checkpointPath);
  assert.equal(differentPacket.controller.snapshot.headSha, NEXT_HEAD);
});

test("local PR workflow brief fails closed without repository and routed-head identity", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "gd-local-pr-bootstrap-missing-"));
  const result = run(workflowBrief, ["create-pr-from-local-work"], stateDir);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /create-pr-from-local-work requires --repo and --head/);
});
