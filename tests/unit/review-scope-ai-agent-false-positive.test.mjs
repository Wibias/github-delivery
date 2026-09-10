import assert from "node:assert/strict";
import test from "node:test";

import { planReviewScope } from "../../scripts/lib/review-scope.mjs";

function file(path, patch) {
  return { path, status: "modified", patch, additions: 1, deletions: 0 };
}

test("ordinary Home Assistant compatibility text does not require AI-agent security", () => {
  const result = planReviewScope({
    repo: "owner/home-assistant-integration",
    pr: 191,
    headRefOid: "head",
    files: [
      file("custom_components/variable/device.py", "+# Home Assistant 2026.8 device registry compatibility\n"),
      file("tests/test_device.py", "+# Preserve the Home Assistant legacy lookup fallback\n"),
    ],
  });

  assert.equal(result.securityReview.requiredDomains.includes("ai_agent_mcp"), false);
});

test("ordinary data-model changes do not accumulate into AI-agent security", () => {
  const result = planReviewScope({
    repo: "owner/app",
    pr: 2,
    headRefOid: "head",
    files: [
      file("src/user.ts", "+const model = await loadUserModel();\n"),
      file("src/order.ts", "+const model = await loadOrderModel();\n"),
    ],
  });

  assert.equal(result.securityReview.requiredDomains.includes("ai_agent_mcp"), false);
});

test("actual agent tool-call changes still require AI-agent security", () => {
  const result = planReviewScope({
    repo: "owner/agent-app",
    pr: 3,
    headRefOid: "head",
    files: [
      file("src/agent.ts", "+const tool_call = await model.invokeTool(request);\n"),
    ],
  });

  assert.equal(result.securityReview.requiredDomains.includes("ai_agent_mcp"), true);
});
