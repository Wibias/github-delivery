#!/usr/bin/env node
import { collectBranchReviewInput, planReviewScope } from "./lib/review-scope.mjs";
import { projectBugScope, projectSecurityScope } from "./lib/review-scope-compat.mjs";

function usageError() {
  throw new Error("Usage: node scripts/pre-open-gate.mjs OWNER/REPO BASE_REF HEAD_REF [--output FILE] | --self-test");
}

function evaluate(plan) {
  const bugScope = projectBugScope(plan);
  const securityScope = projectSecurityScope(plan);
  const blockers = [
    ...bugScope.requiredLenses.map((id) => `bug:requiredLenses:${id}`),
    ...securityScope.requiredSurfaces.map((id) => `security:requiredSurfaces:${id}`),
  ];
  const complete = plan.complete && bugScope.complete && securityScope.complete;
  const decision = !complete ? "unknown" : blockers.length ? "blocked" : "ready";
  return { bugScope, securityScope, blockers, decision, complete };
}

function report({ repo, baseRef, headRef, headRefOid, bugScope, securityScope, blockers, decision, complete }) {
  return {
    schemaVersion: 1,
    kind: "github-delivery/pre-open-gate",
    repo,
    baseRef,
    headRef,
    headRefOid,
    decision,
    complete,
    bugScope,
    securityScope,
    blockers,
    instructions: [
      "decision=blocked: complete every required bug lens and security surface on this branch diff, fix Confirmed High/Critical findings, then rerun before opening the PR.",
      "decision=unknown: restore complete branch evidence (fetch base, checkout head) and rerun; never open a PR from an incomplete diff.",
      "decision=ready: the branch diff has no required bug/security scope; you may proceed to open the PR.",
    ],
  };
}

function parseArgs(argv) {
  const [repo, baseRef, headRef, maybeOutput, outputValue] = argv;
  const output = maybeOutput === "--output" ? outputValue : null;
  if (output === undefined) throw new Error("--output requires a file path");
  return { repo, baseRef, headRef, output };
}

try {
  if (process.argv[2] === "--self-test") {
    const plan = planReviewScope({
      repo: "acme/widget",
      pr: null,
      headRefOid: "abc",
      files: [{ path: "src/worker.ts", patch: "+new Worker(url)\n+worker.terminate()", status: "modified", additions: 2, deletions: 0 }],
    });
    const out = report({ repo: plan.repo, baseRef: "dev", headRef: "feat/x", headRefOid: plan.headRefOid, ...evaluate(plan) });
    if (out.decision !== "blocked" || !out.blockers.some((b) => b.startsWith("bug:requiredLenses:"))) {
      throw new Error("self-test failed: expected blocked with bug lenses");
    }
    process.stdout.write(JSON.stringify({ ok: true, decision: out.decision, blockers: out.blockers }, null, 2) + "\n");
  } else {
    const { repo, baseRef, headRef, output } = parseArgs(process.argv.slice(2));
    if (!repo?.includes("/") || !baseRef || !headRef) usageError();
    const input = collectBranchReviewInput(baseRef, headRef);
    const plan = planReviewScope(input);
    const result = report({ repo, baseRef, headRef, headRefOid: input.headRefOid, ...evaluate(plan) });
    const json = JSON.stringify(result, null, 2) + "\n";
    process.stdout.write(json);
    if (output) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(output, json, "utf8");
    }
    process.exitCode = result.decision === "ready" ? 0 : result.decision === "blocked" ? 1 : 2;
  }
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
