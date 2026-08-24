import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

import {
  createFileRewriteBaselineStore,
  createMemoryRewriteBaselineStore,
  rewriteBaselineScopeKey,
} from "../../scripts/lib/rewrite-baseline-store.mjs";

const SCOPE = { repo: "Wibias/github-delivery", remote: "origin", branch: "feature/safe" };
const SHA = "e".repeat(40);
const storeUrl = pathToFileURL(
  fileURLToPath(new URL("../../scripts/lib/rewrite-baseline-store.mjs", import.meta.url)),
).href;

function waitChild(child) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

function spawnStoreWorker({ root, filePath, readyFile, goFile, action, index }) {
  const scriptPath = join(root, `worker-${index}.mjs`);
  writeFileSync(
    scriptPath,
    `import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createFileRewriteBaselineStore } from ${JSON.stringify(storeUrl)};

const goFile = ${JSON.stringify(goFile)};
const started = Date.now();
writeFileSync(${JSON.stringify(readyFile)}, "ready");
while (!existsSync(goFile)) {
  if (Date.now() - started > 20_000) throw new Error("go wait timed out");
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
}
const store = createFileRewriteBaselineStore({
  path: ${JSON.stringify(filePath)},
  lockWaitMs: 15_000,
  readFile(path, encoding) {
    const text = readFileSync(path, encoding);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    return text;
  },
});
const action = ${JSON.stringify(action)};
try {
  const value = action.op === "create"
    ? store.create(action.scope, action.sha)
    : store.consume(action.scope);
  writeFileSync(${JSON.stringify(`${readyFile}.done`)}, JSON.stringify({ ok: true, value }) + "\\n");
} catch (error) {
  writeFileSync(${JSON.stringify(`${readyFile}.done`)}, JSON.stringify({
    ok: false,
    error: String(error?.message || error),
  }) + "\\n");
  throw error;
}
`,
    "utf8",
  );
  return spawn(process.execPath, [scriptPath], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

async function runConcurrentActions(filePath, actions, { initial } = {}) {
  const root = dirname(filePath);
  mkdirSync(root, { recursive: true });
  if (initial !== undefined) writeFileSync(filePath, `${JSON.stringify(initial)}\n`);
  const goFile = join(root, "go");
  const workers = actions.map((action, index) => {
    const readyFile = join(root, `ready-${index}`);
    const child = spawnStoreWorker({ root, filePath, readyFile, goFile, action, index });
    return { child, readyFile, exit: waitChild(child) };
  });
  const started = Date.now();
  while (workers.some((worker) => {
    try {
      readFileSync(worker.readyFile, "utf8");
      return false;
    } catch {
      return true;
    }
  })) {
    if (Date.now() - started > 8_000) throw new Error("timed out waiting for workers");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  writeFileSync(goFile, "go");
  const results = await Promise.all(workers.map((worker) => worker.exit));
  for (const worker of workers) worker.child.kill("SIGTERM");
  return results;
}

test("memory rewrite baseline store is create-only and consume-once", () => {
  const store = createMemoryRewriteBaselineStore();
  assert.equal(store.read(SCOPE), null);
  assert.equal(store.create(SCOPE, SHA), SHA);
  assert.equal(store.read(SCOPE), SHA);
  assert.throws(() => store.create(SCOPE, "a".repeat(40)), /rewrite_baseline_already_exists/);
  assert.equal(store.consume(SCOPE), SHA);
  assert.equal(store.read(SCOPE), null);
  assert.equal(store.consume(SCOPE), null);
});

test("a corrupt rewrite baseline file is unreadable rather than missing", () => {
  const store = createFileRewriteBaselineStore({
    path: "/tmp/rewrite-baselines.json",
    exists: () => true,
    readFile: () => "{",
    mkdir() {},
    writeFile() {},
    rename() {},
  });
  assert.throws(() => store.read(SCOPE), /rewrite_baseline_store_unreadable/);
});

test("concurrent creates keep both rewrite baselines", async () => {
  const root = mkdtempSync(join(tmpdir(), "gd-rewrite-create-"));
  const filePath = join(root, "rewrite-baselines.json");
  const scopeA = { ...SCOPE, branch: "feature/a" };
  const scopeB = { ...SCOPE, branch: "feature/b" };
  const shaA = "a".repeat(40);
  const shaB = "b".repeat(40);
  const results = await runConcurrentActions(filePath, [
    { op: "create", scope: scopeA, sha: shaA },
    { op: "create", scope: scopeB, sha: shaB },
  ]);
  for (const result of results) {
    assert.equal(result.code, 0, result.stderr || result.stdout);
  }
  const store = createFileRewriteBaselineStore({ path: filePath });
  assert.equal(store.read(scopeA), shaA);
  assert.equal(store.read(scopeB), shaB);
});

test("concurrent consumes cannot resurrect a deleted rewrite baseline", async () => {
  const root = mkdtempSync(join(tmpdir(), "gd-rewrite-consume-"));
  const filePath = join(root, "rewrite-baselines.json");
  const scopeA = { ...SCOPE, branch: "feature/a" };
  const scopeB = { ...SCOPE, branch: "feature/b" };
  const shaA = "a".repeat(40);
  const shaB = "b".repeat(40);
  const results = await runConcurrentActions(
    filePath,
    [
      { op: "consume", scope: scopeA },
      { op: "consume", scope: scopeB },
    ],
    {
      initial: {
        [rewriteBaselineScopeKey(scopeA)]: shaA,
        [rewriteBaselineScopeKey(scopeB)]: shaB,
      },
    },
  );
  for (const result of results) {
    assert.equal(result.code, 0, result.stderr || result.stdout);
  }
  const store = createFileRewriteBaselineStore({ path: filePath });
  assert.equal(store.read(scopeA), null);
  assert.equal(store.read(scopeB), null);
});

test("concurrent create and consume keep the created baseline and drop the consumed one", async () => {
  const root = mkdtempSync(join(tmpdir(), "gd-rewrite-mix-"));
  const filePath = join(root, "rewrite-baselines.json");
  const consumeScope = { ...SCOPE, branch: "feature/consume" };
  const createScope = { ...SCOPE, branch: "feature/create" };
  const consumedSha = "c".repeat(40);
  const createdSha = "d".repeat(40);
  const results = await runConcurrentActions(
    filePath,
    [
      { op: "consume", scope: consumeScope },
      { op: "create", scope: createScope, sha: createdSha },
    ],
    {
      initial: {
        [rewriteBaselineScopeKey(consumeScope)]: consumedSha,
      },
    },
  );
  for (const result of results) {
    assert.equal(result.code, 0, result.stderr || result.stdout);
  }
  const store = createFileRewriteBaselineStore({ path: filePath });
  assert.equal(store.read(consumeScope), null);
  assert.equal(store.read(createScope), createdSha);
});

async function waitForPath(path, timeoutMs = 8_000) {
  const started = Date.now();
  while (!existsSync(path)) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${path}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function spawnStaleTakeoverWorker({
  root,
  filePath,
  action,
  index,
  pauseAfterRead,
  pauseAfterOwnershipCheck,
  readyFile,
  resumeFile,
  staleLockMs,
  lockWaitMs,
}) {
  const scriptPath = join(root, `stale-worker-${index}.mjs`);
  writeFileSync(
    scriptPath,
    `import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createFileRewriteBaselineStore } from ${JSON.stringify(storeUrl)};

function waitForResume() {
  writeFileSync(${JSON.stringify(readyFile)}, "paused");
  const started = Date.now();
  while (!existsSync(${JSON.stringify(resumeFile)})) {
    if (Date.now() - started > 20_000) throw new Error("resume wait timed out");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
}

const store = createFileRewriteBaselineStore({
  path: ${JSON.stringify(filePath)},
  lockWaitMs: ${Number(lockWaitMs)},
  staleLockMs: ${Number(staleLockMs)},
  readFile(path, encoding) {
    const text = readFileSync(path, encoding);
    if (${pauseAfterRead ? "true" : "false"}) waitForResume();
    return text;
  },
  rename(from, to) {
    if (${pauseAfterOwnershipCheck ? "true" : "false"}) waitForResume();
    renameSync(from, to);
  },
});
const action = ${JSON.stringify(action)};
try {
  const value = action.op === "create"
    ? store.create(action.scope, action.sha)
    : store.consume(action.scope);
  writeFileSync(${JSON.stringify(`${readyFile}.done`)}, JSON.stringify({ ok: true, value }) + "\\n");
} catch (error) {
  writeFileSync(${JSON.stringify(`${readyFile}.done`)}, JSON.stringify({
    ok: false,
    error: String(error?.message || error),
  }) + "\\n");
  throw error;
}
`,
    "utf8",
  );
  return spawn(process.execPath, [scriptPath], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

async function runStaleTakeover({
  filePath,
  initial,
  stalledAction,
  takeoverAction,
  pauseAfterOwnershipCheck = false,
}) {
  const root = dirname(filePath);
  mkdirSync(root, { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(initial)}\n`);
  const stalledReady = join(root, "stalled-ready");
  const resumeFile = join(root, "stalled-resume");
  const takeoverReady = join(root, "takeover-ready");
  const stalled = spawnStaleTakeoverWorker({
    root,
    filePath,
    action: stalledAction,
    index: "stalled",
    pauseAfterRead: !pauseAfterOwnershipCheck,
    pauseAfterOwnershipCheck,
    readyFile: stalledReady,
    resumeFile,
    staleLockMs: 80,
    lockWaitMs: 5_000,
  });
  const stalledExit = waitChild(stalled);
  await waitForPath(stalledReady);
  await new Promise((resolve) => setTimeout(resolve, 120));
  const takeover = spawnStaleTakeoverWorker({
    root,
    filePath,
    action: takeoverAction,
    index: "takeover",
    pauseAfterRead: false,
    pauseAfterOwnershipCheck: false,
    readyFile: takeoverReady,
    resumeFile: join(root, "takeover-resume"),
    staleLockMs: 80,
    lockWaitMs: 5_000,
  });
  const takeoverExit = waitChild(takeover);
  const takeoverResult = await takeoverExit;
  writeFileSync(resumeFile, "go");
  const stalledResult = await stalledExit;
  stalled.kill("SIGTERM");
  takeover.kill("SIGTERM");
  return { stalledResult, takeoverResult };
}

test("stale lock takeover cannot drop a newly created baseline", async () => {
  const root = mkdtempSync(join(tmpdir(), "gd-rewrite-stale-drop-"));
  const filePath = join(root, "rewrite-baselines.json");
  const stalledScope = { ...SCOPE, branch: "feature/stalled" };
  const takeoverScope = { ...SCOPE, branch: "feature/takeover" };
  const stalledSha = "1".repeat(40);
  const takeoverSha = "2".repeat(40);
  const { stalledResult, takeoverResult } = await runStaleTakeover({
    filePath,
    initial: {},
    stalledAction: { op: "create", scope: stalledScope, sha: stalledSha },
    takeoverAction: { op: "create", scope: takeoverScope, sha: takeoverSha },
  });
  assert.equal(takeoverResult.code, 0, takeoverResult.stderr || takeoverResult.stdout);
  assert.notEqual(stalledResult.code, 0);
  assert.match(`${stalledResult.stderr}\n${stalledResult.stdout}`, /rewrite_baseline_store_lock_lost/);
  const store = createFileRewriteBaselineStore({ path: filePath });
  assert.equal(store.read(takeoverScope), takeoverSha);
  assert.equal(store.read(stalledScope), null);
});

test("stale lock takeover cannot resurrect a consumed baseline", async () => {
  const root = mkdtempSync(join(tmpdir(), "gd-rewrite-stale-resurrect-"));
  const filePath = join(root, "rewrite-baselines.json");
  const scopeA = { ...SCOPE, branch: "feature/a" };
  const scopeB = { ...SCOPE, branch: "feature/b" };
  const shaA = "a".repeat(40);
  const shaB = "b".repeat(40);
  const { stalledResult, takeoverResult } = await runStaleTakeover({
    filePath,
    initial: {
      [rewriteBaselineScopeKey(scopeA)]: shaA,
      [rewriteBaselineScopeKey(scopeB)]: shaB,
    },
    stalledAction: { op: "consume", scope: scopeA },
    takeoverAction: { op: "consume", scope: scopeB },
  });
  assert.equal(takeoverResult.code, 0, takeoverResult.stderr || takeoverResult.stdout);
  assert.notEqual(stalledResult.code, 0);
  assert.match(`${stalledResult.stderr}\n${stalledResult.stdout}`, /rewrite_baseline_store_lock_lost/);
  const store = createFileRewriteBaselineStore({ path: filePath });
  assert.equal(store.read(scopeA), shaA);
  assert.equal(store.read(scopeB), null);
});

function ageLockFile(lockPath) {
  const past = new Date(Date.now() - 1_000);
  utimesSync(lockPath, past, past);
}

test("a stale empty lock file can be reclaimed", () => {
  const root = mkdtempSync(join(tmpdir(), "gd-rewrite-empty-lock-"));
  const filePath = join(root, "rewrite-baselines.json");
  const store = createFileRewriteBaselineStore({
    path: filePath,
    lockWaitMs: 200,
    staleLockMs: 50,
  });
  store.create(SCOPE, SHA);
  const lockPath = `${filePath}.lock`;
  writeFileSync(lockPath, "");
  ageLockFile(lockPath);
  assert.equal(store.consume(SCOPE), SHA);
  assert.equal(store.read(SCOPE), null);
  assert.equal(existsSync(lockPath), false);
});

test("a stale truncated lock file can be reclaimed", () => {
  const root = mkdtempSync(join(tmpdir(), "gd-rewrite-trunc-lock-"));
  const filePath = join(root, "rewrite-baselines.json");
  const store = createFileRewriteBaselineStore({
    path: filePath,
    lockWaitMs: 200,
    staleLockMs: 50,
  });
  store.create(SCOPE, SHA);
  const lockPath = `${filePath}.lock`;
  writeFileSync(lockPath, "{");
  ageLockFile(lockPath);
  assert.equal(store.consume(SCOPE), SHA);
  assert.equal(store.read(SCOPE), null);
});

test("stale lock takeover after the last ownership check cannot drop a created baseline", async () => {
  const root = mkdtempSync(join(tmpdir(), "gd-rewrite-stale-rename-drop-"));
  const filePath = join(root, "rewrite-baselines.json");
  const stalledScope = { ...SCOPE, branch: "feature/stalled" };
  const takeoverScope = { ...SCOPE, branch: "feature/takeover" };
  const stalledSha = "1".repeat(40);
  const takeoverSha = "2".repeat(40);
  const { stalledResult, takeoverResult } = await runStaleTakeover({
    filePath,
    initial: {},
    stalledAction: { op: "create", scope: stalledScope, sha: stalledSha },
    takeoverAction: { op: "create", scope: takeoverScope, sha: takeoverSha },
    pauseAfterOwnershipCheck: true,
  });
  assert.equal(takeoverResult.code, 0, takeoverResult.stderr || takeoverResult.stdout);
  assert.notEqual(stalledResult.code, 0);
  const store = createFileRewriteBaselineStore({ path: filePath });
  assert.equal(store.read(takeoverScope), takeoverSha);
  assert.equal(store.read(stalledScope), null);
});

test("stale lock takeover after the last ownership check cannot resurrect a consumed baseline", async () => {
  const root = mkdtempSync(join(tmpdir(), "gd-rewrite-stale-rename-resurrect-"));
  const filePath = join(root, "rewrite-baselines.json");
  const scopeA = { ...SCOPE, branch: "feature/a" };
  const scopeB = { ...SCOPE, branch: "feature/b" };
  const shaA = "a".repeat(40);
  const shaB = "b".repeat(40);
  const { stalledResult, takeoverResult } = await runStaleTakeover({
    filePath,
    initial: {
      [rewriteBaselineScopeKey(scopeA)]: shaA,
      [rewriteBaselineScopeKey(scopeB)]: shaB,
    },
    stalledAction: { op: "consume", scope: scopeA },
    takeoverAction: { op: "consume", scope: scopeB },
    pauseAfterOwnershipCheck: true,
  });
  assert.equal(takeoverResult.code, 0, takeoverResult.stderr || takeoverResult.stdout);
  assert.notEqual(stalledResult.code, 0);
  const store = createFileRewriteBaselineStore({ path: filePath });
  assert.equal(store.read(scopeA), shaA);
  assert.equal(store.read(scopeB), null);
});

