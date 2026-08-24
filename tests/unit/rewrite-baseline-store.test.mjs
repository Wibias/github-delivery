import assert from "node:assert/strict";
import test from "node:test";

import { createFileRewriteBaselineStore, createMemoryRewriteBaselineStore } from "../../scripts/lib/rewrite-baseline-store.mjs";

const SCOPE = { repo: "Wibias/github-delivery", remote: "origin", branch: "feature/safe" };
const SHA = "e".repeat(40);

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
