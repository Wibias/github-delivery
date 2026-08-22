import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { listDeliveryWorkflowProfiles } from "../../scripts/lib/delivery-workflow-profiles.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const ALLOWED = /Do not load `references\/shared-rules\.md` as mandatory context[^\n]*/gi;

function slash(path) {
  return path.replaceAll("\\", "/");
}

function leftoverSharedRules(text) {
  const stripped = text.replace(ALLOWED, "");
  return /shared-rules\.md|shared-rules \*\*~30–60s\*\*/i.test(stripped);
}

function workflowFiles() {
  const routed = listDeliveryWorkflowProfiles().map((profile) => profile.workflowPath);
  const extras = [
    "references/prepare-and-merge-pr.md",
    "references/review-contract-compact.md",
    "overrides/babysit/SKILL.md",
    "overrides/babysit-pr/SKILL.md",
    "overrides/review-security/SKILL.md",
  ];
  return [...new Set([...routed, ...extras].map(slash))];
}

test("routed workflows do not instruct loading shared-rules as mandatory context", () => {
  const offenders = [];
  for (const relative of workflowFiles()) {
    const text = readFileSync(join(ROOT, relative), "utf8");
    if (leftoverSharedRules(text)) offenders.push(relative);
  }
  assert.deepEqual(offenders, []);
});

