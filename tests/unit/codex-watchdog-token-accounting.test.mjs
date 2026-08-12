import assert from "node:assert/strict";
import test from "node:test";

import { createAppServerWatchdogRouter } from "../../scripts/lib/codex-app-server-watchdog-proxy.mjs";

function usage(router, { totalTokens, outputTokens }) {
  return router.onServerMessage({
    method: "thread/tokenUsage/updated",
    params: {
      threadId: "thr-token-accounting",
      turnId: "turn-token-accounting",
      tokenUsage: {
        total: { totalTokens, outputTokens },
        last: { totalTokens, outputTokens },
      },
    },
  });
}

test("large input-token growth alone does not exhaust the no-progress generation budget", () => {
  const router = createAppServerWatchdogRouter({
    internalRequestIdPrefix: "gd-token-accounting",
    watchdogOptions: {
      noProgressTokenSoftLimit: 10,
      noProgressTokenHardLimit: 20,
      generatedCharHardLimit: 10_000,
      toolEmissionIntentThreshold: 50,
    },
  });

  usage(router, { totalTokens: 10_000, outputTokens: 100 });
  const contextHeavy = usage(router, { totalTokens: 90_000, outputTokens: 105 });
  assert.equal(contextHeavy.internalRequests.length, 0);

  const generatedTooMuch = usage(router, { totalTokens: 90_020, outputTokens: 121 });
  assert.equal(generatedTooMuch.internalRequests.length, 1);
  assert.equal(generatedTooMuch.internalRequests[0].method, "turn/interrupt");
});
