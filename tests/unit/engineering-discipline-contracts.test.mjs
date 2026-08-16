import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("implementation selects the smallest complete solution before adding custom structure", () => {
  const minimalUrl = new URL(
    "../../references/minimal-solution.md",
    import.meta.url,
  );
  assert.ok(existsSync(minimalUrl), "expected minimal-solution companion");

  const minimal = readFileSync(minimalUrl, "utf8");
  const createPr = read("references/create-pr-for-issue.md");
  const issueWorkflows = read("references/issue-workflows.md");
  const simplify = read("references/simplify-pr.md");

  assert.match(minimal, /## The ladder/);
  assert.match(minimal, /Reuse an existing repository capability/);
  assert.match(minimal, /language\/runtime standard library/);
  assert.match(minimal, /Use the native platform/);
  assert.match(minimal, /already-installed dependency/);
  assert.match(minimal, /minimum custom implementation/i);
  assert.match(minimal, /Never simplify away/);
  assert.match(createPr, /references\/minimal-solution\.md/);
  assert.match(issueWorkflows, /references\/minimal-solution\.md/);
  assert.match(simplify, /references\/minimal-solution\.md/);
  assert.match(simplify, /Line count is never the objective or a success metric/);
});

test("difficult bug fixes build a tight symptom signal before testing ranked hypotheses", () => {
  const bugHunt = read("references/bug-hunt-method.md");

  assert.match(bugHunt, /Phase 0 — Tight symptom signal/);
  assert.match(bugHunt, /red-capable/i);
  assert.match(bugHunt, /Minimize the reproducer/i);
  assert.match(bugHunt, /3–5 ranked candidate\s+hypotheses/);
  assert.match(bugHunt, /one variable at a time/i);
  assert.match(bugHunt, /Do not manufacture a broad\s+harness for an obvious defect/i);
  assert.match(bugHunt, /Matt Pocock.*diagnosing-bugs/is);
});

test("wide refactors can use an explicit expand-migrate-contract sequence", () => {
  const changeExecution = read("references/change-execution.md");
  const issueWorkflows = read("references/issue-workflows.md");

  assert.match(changeExecution, /Expand-contract when one-step migration cannot stay green/);
  assert.match(changeExecution, /\*\*Expand:\*\*/);
  assert.match(changeExecution, /\*\*Migrate:\*\*/);
  assert.match(changeExecution, /\*\*Contract:\*\*/);
  assert.match(changeExecution, /migration scaffold.*not evidence of a supported compatibility contract/is);
  assert.match(changeExecution, /Migration strategy:.*expand-contract/is);
  assert.match(issueWorkflows, /expand-contract branch in `references\/change-execution\.md`/);
  assert.match(issueWorkflows, /select direct vs expand-contract vs bounded non-shippable migration/i);
});

test("completion reports remeasure material claims instead of trusting memory", () => {
  const completionUrl = new URL(
    "../../references/completion-claims.md",
    import.meta.url,
  );
  assert.ok(existsSync(completionUrl), "expected completion-claims companion");

  const completion = readFileSync(completionUrl, "utf8");
  const publication = read("references/policy/publication.md");
  const createPr = read("references/create-pr-for-issue.md");
  const changeExecution = read("references/change-execution.md");

  assert.match(completion, /A completion report is a set of evidence-backed claims/);
  assert.match(completion, /Every numeric claim that matters enough to publish/i);
  assert.match(completion, /Do not recount from memory/i);
  assert.match(completion, /0 unresolved threads/);
  assert.match(completion, /head-bound claims/i);
  assert.match(publication, /GD-PUB-010/);
  assert.match(publication, /references\/completion-claims\.md/);
  assert.match(createPr, /## H\. Completion report/);
  assert.match(changeExecution, /references\/completion-claims\.md/);
});

test("design review and simplification use deep-module signals without overriding repository language", () => {
  const design = read("references/design-quality.md");
  const simplify = read("references/simplify-pr.md");

  assert.match(design, /### Deep-module checks/);
  assert.match(design, /Deletion test/);
  assert.match(design, /Interface as test surface/);
  assert.match(design, /Real seam test/);
  assert.match(design, /Leverage and locality/);
  assert.match(design, /Do not force repository terminology/);
  assert.match(simplify, /deletion test/i);
  assert.match(simplify, /speculative seams\/interfaces/i);
});

test("triage can surface a read-only attention inbox", () => {
  const issueWorkflows = read("references/issue-workflows.md");

  assert.match(issueWorkflows, /### Triage inbox/);
  assert.match(issueWorkflows, /\*\*Untriaged:\*\*/);
  assert.match(issueWorkflows, /\*\*Needs triage:\*\*/);
  assert.match(issueWorkflows, /\*\*Needs-info with new reporter activity:\*\*/);
  assert.match(issueWorkflows, /Do not move labels merely because an item appears in the inbox/);
});
