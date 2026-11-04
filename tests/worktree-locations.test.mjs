import assert from "node:assert/strict";
import { existsSync, rmSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseArgs,
  resolveVerificationCloneRoot,
  createVerificationWorktreeRoot,
} from "../scripts/verify-pr-head.mjs";

const scriptPath = fileURLToPath(new URL("../scripts/verify-pr-head.mjs", import.meta.url));
const guidePath = fileURLToPath(new URL("../references/full-review-pr.md", import.meta.url));

test("default worktree root is created inside the platform temporary directory", () => {
  const result = createVerificationWorktreeRoot();
  try {
    assert.equal(result.disposable, true);
    assert.equal(result.path.startsWith(join(tmpdir(), "github-delivery-verify-pr-")), true);
    assert.equal(statSync(result.path).isDirectory(), true);
  } finally {
    if (existsSync(result.path)) rmSync(result.path, { recursive: true, force: true });
  }
});

test("default worktree root uses platform path semantics on POSIX and Windows", () => {
  for (const value of [
    { tempRoot: "/var/tmp", pathJoin: posix.join },
    { tempRoot: "Q:/Sandbox/Temp", pathJoin: win32.join },
  ]) {
    const expectedPrefix = value.pathJoin(value.tempRoot, "github-delivery-verify-pr-");
    let seenPrefix;
    const result = createVerificationWorktreeRoot({
      tempRoot: value.tempRoot,
      pathJoin: value.pathJoin,
      makeTempRoot(prefix) {
        seenPrefix = prefix;
        return `${prefix}abc123`;
      },
    });
    assert.equal(seenPrefix, expectedPrefix);
    assert.deepEqual(result, { path: `${expectedPrefix}abc123`, disposable: true });
  }
});

test("explicit --worktree-root overrides the default without creating a temp root", () => {
  const linuxRoot = "/srv/verification";
  const windowsRoot = "Q:/Custom/Worktrees";
  for (const root of [linuxRoot, windowsRoot]) {
    const parsed = parseArgs(["owner/repo", "17", "--worktree-root", root]);
    const result = createVerificationWorktreeRoot({
      worktreeRoot: parsed.worktreeRoot,
      makeTempRoot() { throw new Error("override must skip temporary-directory creation"); },
    });
    assert.deepEqual(result, { path: root, disposable: false });
  }
});

test("clone selection uses cwd by default and an explicit --clone-root elsewhere", () => {
  const cwd = "/work/repository";
  assert.equal(resolveVerificationCloneRoot({ cwd }), cwd);
  const parsed = parseArgs(["owner/repo", "17", "--clone-root", "Q:/Project/repo"]);
  assert.equal(parsed.cloneRoot, "Q:/Project/repo");
  assert.equal(resolveVerificationCloneRoot({ cwd, cloneRoot: parsed.cloneRoot }), parsed.cloneRoot);
  assert.throws(() => parseArgs(["owner/repo", "17", "--clone-root"]), /--clone-root requires a path/);
});

test("published review guidance and verification script avoid operator-specific worktree roots", () => {
  const source = readFileSync(scriptPath, "utf8");
  const guide = readFileSync(guidePath, "utf8");
  assert.doesNotMatch(source, /codex-worktrees/i);
  assert.doesNotMatch(guide, /codex-worktrees/i);
  assert.doesNotMatch(source, /join\(\s*["']C:\s*["'],\s*["']Users["']/);
  assert.match(guide, /--keep-worktree/);
  assert.match(guide, /--worktree-root/);
});
