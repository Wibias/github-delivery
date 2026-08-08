import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  parsePolicyModules,
  resolvePolicyBundle,
} from "../../scripts/lib/policy-bundle.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "gd-policy-bundle-"));
  mkdirSync(join(root, "references", "policy"), { recursive: true });
  writeFileSync(
    join(root, "references", "policy-kernel.md"),
    "# Kernel\n\n### GD-CORE-001 — Fail closed\nEvidence gaps block claims.\n",
  );
  writeFileSync(
    join(root, "references", "policy", "mutation.md"),
    "# Mutation\n\n### GD-AUTH-001 — Bound writes\nWrites require authority.\n",
  );
  writeFileSync(
    join(root, "references", "policy", "stacks.md"),
    "# Stacks\n\n### GD-STACK-001 — Bottom up\nMerge bottom-up.\n",
  );
  writeFileSync(
    join(root, "references", "merge-pr.md"),
    [
      "# Merge PR",
      "",
      "<!-- policy-modules:start -->",
      "Policy modules:",
      "- policy-kernel",
      "- mutation",
      "- stacks (when stack topology is detected)",
      "<!-- policy-modules:end -->",
      "",
      "Apply GD-CORE-001 and GD-AUTH-001.",
      "",
    ].join("\n"),
  );
  return root;
}

test("policy declarations parse unconditional and conditional modules", () => {
  const parsed = parsePolicyModules(`
<!-- policy-modules:start -->
Policy modules:
- policy-kernel
- mutation
- stacks (when stack topology is detected)
<!-- policy-modules:end -->
`);
  assert.deepEqual(parsed, {
    modules: ["policy-kernel", "mutation"],
    conditionalModules: [
      { module: "stacks", condition: "stack topology is detected" },
    ],
  });
});

test("resolvePolicyBundle returns a deterministic minimal bundle", () => {
  const root = fixture();
  try {
    const first = resolvePolicyBundle({ root, workflow: "merge-pr" });
    const second = resolvePolicyBundle({ root, workflow: "references/merge-pr.md" });
    assert.deepEqual(first, second);
    assert.equal(first.workflow, "merge-pr");
    assert.equal(first.workflowPath, "references/merge-pr.md");
    assert.equal(first.kernelPath, "references/policy-kernel.md");
    assert.deepEqual(first.modules, ["references/policy/mutation.md"]);
    assert.deepEqual(first.conditionalModules, [
      {
        module: "stacks",
        path: "references/policy/stacks.md",
        condition: "stack topology is detected",
      },
    ]);
    assert.deepEqual(first.ruleIds, ["GD-AUTH-001", "GD-CORE-001"]);
    assert.ok(first.bytes.total > 0);
    assert.ok(first.bytes.workflow > 0);
    assert.ok(first.bytes.kernel > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolvePolicyBundle fails closed on undeclared or missing policy modules", () => {
  const root = fixture();
  try {
    writeFileSync(
      join(root, "references", "merge-pr.md"),
      "# Merge PR\n\n<!-- policy-modules:start -->\nPolicy modules:\n- policy-kernel\n- missing\n<!-- policy-modules:end -->\n",
    );
    assert.throws(
      () => resolvePolicyBundle({ root, workflow: "merge-pr" }),
      /policy_module_missing:missing/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
