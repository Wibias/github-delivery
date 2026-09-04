import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const CLI = fileURLToPath(new URL("../../scripts/create-pr-hygiene.mjs", import.meta.url));

function run(cwd, command, args) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stderr}\n${result.stdout}`);
  return String(result.stdout || "").trim();
}

function git(cwd, args) {
  return run(cwd, "git", args);
}

function commit(cwd, message) {
  git(cwd, ["add", "."]);
  git(cwd, ["commit", "-m", message]);
  return git(cwd, ["rev-parse", "HEAD"]);
}

test("create-pr hygiene CLI prepares guarded diff scope and finalizes current-head evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "github-delivery-hygiene-cli-"));
  const repo = join(root, "repo");
  const scopePath = join(root, "scope.json");
  const snapshotPath = join(root, "snapshot.json");
  const resultPath = join(root, "comment-result.json");
  const simplifyPath = join(root, "simplify.json");
  const outputPath = join(root, "hygiene.json");
  try {
    mkdirSync(repo);
    git(repo, ["init"]);
    git(repo, ["config", "user.email", "test@example.com"]);
    git(repo, ["config", "user.name", "github-delivery test"]);
    writeFileSync(join(repo, "ui.ts"), "export const value = 1;\n", "utf8");
    const base = commit(repo, "base");
    writeFileSync(
      join(repo, "ui.ts"),
      "export const value = 1;\n// Public API compatibility contract.\nexport const next = 2;\n",
      "utf8",
    );
    const head = commit(repo, "candidate");

    run(repo, process.execPath, [
      CLI,
      "prepare",
      "--root", repo,
      "--base", base,
      "--head", head,
      "--scope", scopePath,
      "--snapshot", snapshotPath,
    ]);
    assert.equal(existsSync(snapshotPath), true);
    const scope = JSON.parse(readFileSync(scopePath, "utf8"));
    assert.deepEqual(scope.files, [{ path: "ui.ts", addedRanges: [{ start: 2, end: 3 }] }]);

    writeFileSync(resultPath, `${JSON.stringify({
      schemaVersion: 1,
      kind: "github-delivery/comment-review-result",
      scopeDigest: scope.scopeDigest,
      classifications: [
        {
          path: "ui.ts",
          line: 2,
          disposition: "KEEP",
          reason: "public API contract",
        },
      ],
      rootCauseFlags: [],
    }, null, 2)}\n`, "utf8");
    writeFileSync(simplifyPath, `${JSON.stringify({
      outcome: "clean",
      method: "simplify-pass",
      validationPassed: true,
    }, null, 2)}\n`, "utf8");

    run(repo, process.execPath, [
      CLI,
      "finalize",
      "--root", repo,
      "--head", head,
      "--scope", scopePath,
      "--snapshot", snapshotPath,
      "--result", resultPath,
      "--simplify", simplifyPath,
      "--output", outputPath,
    ]);
    assert.equal(existsSync(snapshotPath), false);
    const evidence = JSON.parse(readFileSync(outputPath, "utf8"));
    assert.equal(evidence.headSha, head);
    assert.equal(evidence.passes["no-comments"].outcome, "clean");
    assert.equal(evidence.passes.simplify.outcome, "clean");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("create-pr hygiene CLI records an explicit no-comments opt-out without a reviewer snapshot", () => {
  const root = mkdtempSync(join(tmpdir(), "github-delivery-hygiene-skip-"));
  const simplifyPath = join(root, "simplify.json");
  const outputPath = join(root, "hygiene.json");
  const head = "a".repeat(40);
  try {
    writeFileSync(simplifyPath, `${JSON.stringify({
      outcome: "skipped",
      method: "opt-out",
      reason: "without simplify",
    }, null, 2)}\n`, "utf8");
    run(root, process.execPath, [
      CLI,
      "skip-no-comments",
      "--head", head,
      "--reason", "keep source comments",
      "--simplify", simplifyPath,
      "--output", outputPath,
    ]);
    const evidence = JSON.parse(readFileSync(outputPath, "utf8"));
    assert.equal(evidence.passes["no-comments"].outcome, "skipped");
    assert.equal(evidence.passes["no-comments"].reason, "keep source comments");
    assert.equal(evidence.passes.simplify.outcome, "skipped");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
