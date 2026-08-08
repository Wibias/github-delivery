import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  validatePolicyArchitecture,
} from "../../scripts/lib/policy-bundle.mjs";

const repoRoot = resolve(new URL("../..", import.meta.url).pathname);

function write(root, path, content) {
  const full = join(root, ...path.split("/"));
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

function fixture({ extraPolicy = "", workflowTail = "" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "gd-policy-arch-"));
  write(
    root,
    "SKILL.md",
    [
      "---",
      "name: fixture",
      "description: fixture",
      "---",
      "# Fixture",
      "## Route",
      "| Request | Workflow |",
      "| --- | --- |",
      "| Merge | `references/merge-pr.md` |",
      "## Policy loading",
      "Load only declared modules.",
      "",
    ].join("\n"),
  );
  write(
    root,
    "references/policy-kernel.md",
    "# Kernel\n\n### GD-CORE-001 — Fail closed\nEvidence gaps block claims.\n",
  );
  write(
    root,
    "references/policy/mutation.md",
    [
      "# Mutation",
      "",
      "### GD-AUTH-001 — Bound writes",
      "Writes require authority.",
      extraPolicy,
      "",
    ].join("\n"),
  );
  write(
    root,
    "references/merge-pr.md",
    [
      "# Merge PR",
      "",
      "<!-- policy-modules:start -->",
      "Policy modules:",
      "- policy-kernel",
      "- mutation",
      "<!-- policy-modules:end -->",
      "",
      "Apply GD-CORE-001 and GD-AUTH-001.",
      workflowTail,
      "",
    ].join("\n"),
  );
  write(root, "references/shared-rules.md", "# Compatibility index only\n");
  return root;
}

test("the repository policy graph is valid and meets the 60% context budget", () => {
  const report = validatePolicyArchitecture({ root: repoRoot });
  assert.equal(report.valid, true, report.errors.join("\n"));
  assert.ok(report.metrics.skillReduction >= 0.6, JSON.stringify(report.metrics));
  assert.ok(report.metrics.universalReduction >= 0.6, JSON.stringify(report.metrics));
  assert.equal(report.errors.length, 0);
  assert.ok(report.metrics.routedWorkflows > 5);
  assert.ok(report.metrics.ruleCount > 10);
});

test("architecture validation rejects duplicate and malformed rule definitions", () => {
  const root = fixture({
    extraPolicy:
      "\n### GD-CORE-001 — Duplicate\nDuplicate definition.\n\n### GD-AUTH-1 — Malformed\nBad ID.\n",
  });
  try {
    const report = validatePolicyArchitecture({
      root,
      baselineSkillBytes: 10_000,
      baselineUniversalBytes: 20_000,
    });
    assert.equal(report.valid, false);
    assert.ok(report.errors.some((value) => value.includes("duplicate_rule_id:GD-CORE-001")));
    assert.ok(report.errors.some((value) => value.includes("malformed_rule_id:GD-AUTH-1")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("architecture validation rejects unknown rule references", () => {
  const root = fixture({ workflowTail: "Also apply GD-NOPE-999." });
  try {
    const report = validatePolicyArchitecture({
      root,
      baselineSkillBytes: 10_000,
      baselineUniversalBytes: 20_000,
    });
    assert.equal(report.valid, false);
    assert.ok(report.errors.some((value) => value.includes("unknown_rule_reference:GD-NOPE-999")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("architecture validation rejects missing modules and monolithic shared-rules dependencies", () => {
  const root = fixture();
  try {
    write(
      root,
      "references/merge-pr.md",
      "# Merge\n\n<!-- policy-modules:start -->\nPolicy modules:\n- policy-kernel\n- missing\n- shared-rules\n<!-- policy-modules:end -->\n",
    );
    const report = validatePolicyArchitecture({
      root,
      baselineSkillBytes: 10_000,
      baselineUniversalBytes: 20_000,
    });
    assert.equal(report.valid, false);
    assert.ok(report.errors.some((value) => value.includes("policy_module_missing:missing")));
    assert.ok(report.errors.some((value) => value.includes("shared_rules_dependency_forbidden")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("architecture validation rejects cycles and orphan policy modules", () => {
  const root = fixture();
  try {
    write(
      root,
      "references/policy/mutation.md",
      "# Mutation\n\n<!-- policy-dependencies:start -->\nPolicy dependencies:\n- evidence\n<!-- policy-dependencies:end -->\n\n### GD-AUTH-001 — Bound writes\nWrites require authority.\n",
    );
    write(
      root,
      "references/policy/evidence.md",
      "# Evidence\n\n<!-- policy-dependencies:start -->\nPolicy dependencies:\n- mutation\n<!-- policy-dependencies:end -->\n\n### GD-EVID-001 — Complete evidence\nEvidence must be complete.\n",
    );
    write(
      root,
      "references/policy/releases.md",
      "# Releases\n\n### GD-REL-001 — Release gate\nGate releases.\n",
    );
    const report = validatePolicyArchitecture({
      root,
      baselineSkillBytes: 10_000,
      baselineUniversalBytes: 20_000,
    });
    assert.equal(report.valid, false);
    assert.ok(report.errors.some((value) => value.startsWith("policy_dependency_cycle:")));
    assert.ok(report.errors.some((value) => value.includes("orphan_policy_module:releases")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("architecture validation rejects missing routed workflow files and size-budget regressions", () => {
  const root = fixture();
  try {
    write(
      root,
      "SKILL.md",
      "# Large route document that intentionally exceeds its tiny baseline.\n## Route\n| Request | Workflow |\n| --- | --- |\n| Missing | `references/missing.md` |\n## Policy loading\n",
    );
    const report = validatePolicyArchitecture({
      root,
      baselineSkillBytes: 100,
      baselineUniversalBytes: 120,
      requiredReduction: 0.6,
    });
    assert.equal(report.valid, false);
    assert.ok(report.errors.some((value) => value.includes("routed_workflow_missing:references/missing.md")));
    assert.ok(report.errors.some((value) => value.startsWith("skill_size_budget_exceeded:")));
    assert.ok(report.errors.some((value) => value.startsWith("universal_size_budget_exceeded:")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
