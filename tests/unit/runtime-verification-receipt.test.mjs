import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { evaluateRuntimeVerificationReceipt } from "../../scripts/runtime-verification-receipt.mjs";

const HEAD = "0123456789abcdef0123456789abcdef01234567";
const OTHER_HEAD = "89abcdef0123456789abcdef0123456789abcdef";

async function receipt(overrides = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "gd-runtime-receipt-"));
  const file = path.join(directory, "receipt.json");
  await writeFile(file, JSON.stringify({
    schema_version: 1,
    run_id: "run-1",
    repository: "owner/repo",
    head_sha: HEAD,
    surface: "cli",
    feature: "settings",
    result: "pass",
    checks: [{ id: "settings-roundtrip", result: "pass" }],
    artifacts: [],
    side_effects: [],
    started_resources: [],
    cleanup: "pass",
    blocked_reason: null,
    ...overrides,
  }));
  return file;
}

test("accepts a passing receipt only for the exact current head", async () => {
  const result = await evaluateRuntimeVerificationReceipt({
    receiptPath: await receipt(),
    repository: "owner/repo",
    headSha: HEAD,
  });
  assert.equal(result.status, "pass_current");
  assert.equal(result.current, true);
});

test("classifies an otherwise passing receipt from another head as stale", async () => {
  const result = await evaluateRuntimeVerificationReceipt({
    receiptPath: await receipt({ head_sha: OTHER_HEAD }),
    repository: "owner/repo",
    headSha: HEAD,
  });
  assert.equal(result.status, "stale");
  assert.equal(result.current, false);
});

test("preserves current-head fail and blocked semantics", async () => {
  const failed = await evaluateRuntimeVerificationReceipt({
    receiptPath: await receipt({ result: "fail", checks: [{ id: "settings-roundtrip", result: "fail" }] }),
    repository: "owner/repo",
    headSha: HEAD,
  });
  assert.equal(failed.status, "fail");

  const blocked = await evaluateRuntimeVerificationReceipt({
    receiptPath: await receipt({ result: "blocked", checks: [], blocked_reason: "credentials unavailable" }),
    repository: "owner/repo",
    headSha: HEAD,
  });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.blocked_reason, "credentials unavailable");
});

test("rejects repository mismatch and malformed pass receipts", async () => {
  await assert.rejects(
    evaluateRuntimeVerificationReceipt({
      receiptPath: await receipt(),
      repository: "other/repo",
      headSha: HEAD,
    }),
    /repository_mismatch/,
  );

  await assert.rejects(
    evaluateRuntimeVerificationReceipt({
      receiptPath: await receipt({ cleanup: "fail" }),
      repository: "owner/repo",
      headSha: HEAD,
    }),
    /pass_requires_cleanup_pass/,
  );
});

test("requires full 40-character expected and receipt SHAs", async () => {
  await assert.rejects(
    evaluateRuntimeVerificationReceipt({
      receiptPath: await receipt(),
      repository: "owner/repo",
      headSha: "abc123",
    }),
    /head_sha_invalid/,
  );

  await assert.rejects(
    evaluateRuntimeVerificationReceipt({
      receiptPath: await receipt({ head_sha: "abc123" }),
      repository: "owner/repo",
      headSha: HEAD,
    }),
    /receipt_head_sha_invalid/,
  );
});

test("matches the producer surface contract", async () => {
  await assert.rejects(
    evaluateRuntimeVerificationReceipt({
      receiptPath: await receipt({ surface: undefined }),
      repository: "owner/repo",
      headSha: HEAD,
    }),
    /receipt_surface_invalid/,
  );

  await assert.rejects(
    evaluateRuntimeVerificationReceipt({
      receiptPath: await receipt({ surface: "console" }),
      repository: "owner/repo",
      headSha: HEAD,
    }),
    /receipt_surface_invalid/,
  );

  const tui = await evaluateRuntimeVerificationReceipt({
    receiptPath: await receipt({ surface: "tui" }),
    repository: "owner/repo",
    headSha: HEAD,
  });
  assert.equal(tui.status, "pass_current");
});
