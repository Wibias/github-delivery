#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import { collectBranchReviewInput, planReviewScope } from "./lib/review-scope.mjs";
import { projectBugScope, projectSecurityScope } from "./lib/review-scope-compat.mjs";
import { evidenceClears, validatePreOpenEvidence } from "./lib/pre-open-evidence.mjs";

function usageError() {
  throw new Error("Usage: node scripts/pre-open-gate.mjs OWNER/REPO BASE_REF HEAD_REF [--output FILE] [--evidence-file FILE] | --self-test");
}

export function evaluate(plan, evidence = null) {
  const bugScope = projectBugScope(plan);
  const securityScope = projectSecurityScope(plan);
  const blockers = [
    ...bugScope.requiredLenses.map((id) => `bug:requiredLenses:${id}`),
    ...securityScope.requiredSurfaces.map((id) => `security:requiredSurfaces:${id}`),
  ];
  const complete = plan.complete && bugScope.complete && securityScope.complete;
  const lensMap = evidence?.lenses ?? {};
  const surfaceMap = evidence?.surfaces ?? {};
  const clearedByEvidence = [];
  const remainingBlockers = blockers.filter((blocker) => {
    const [axis, , id] = blocker.split(":");
    const cleared = axis === "bug" ? evidenceClears(lensMap, id) : evidenceClears(surfaceMap, id);
    if (cleared) clearedByEvidence.push(blocker);
    return !cleared;
  });
  const decision = !complete ? "unknown" : remainingBlockers.length ? "blocked" : "ready";
  return {
    bugScope,
    securityScope,
    blockers: remainingBlockers,
    clearedByEvidence,
    decision,
    complete,
    evidenceApplied: Boolean(evidence),
  };
}

function report({ repo, baseRef, headRef, headRefOid, bugScope, securityScope, blockers, clearedByEvidence, decision, complete, evidenceApplied }) {
  return {
    schemaVersion: 1,
    kind: "github-delivery/pre-open-gate",
    repo,
    baseRef,
    headRef,
    headRefOid,
    decision,
    complete,
    evidenceApplied,
    bugScope,
    securityScope,
    blockers,
    clearedByEvidence,
    instructions: [
      "decision=blocked: complete every remaining required bug lens and security surface on this branch diff (with --evidence-file), fix Confirmed High/Critical findings, then rerun before opening the PR.",
      "decision=unknown: restore complete branch evidence (fetch base, checkout head) and rerun; never open a PR from an incomplete diff.",
      "decision=ready: the branch diff has no required bug/security scope, or every required lens/surface carries valid done/n-a evidence; you may proceed to open the PR.",
    ],
  };
}

function parseArgs(argv) {
  let repo = null;
  let baseRef = null;
  let headRef = null;
  let output = null;
  let evidenceFile = null;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--output") {
      output = argv[++index];
      if (output === undefined) throw new Error("--output requires a file path");
    } else if (value === "--evidence-file") {
      if (evidenceFile !== null) throw new Error("--evidence-file may be given only once");
      evidenceFile = argv[++index];
      if (evidenceFile === undefined) throw new Error("--evidence-file requires a file path");
    } else if (repo === null) {
      repo = value;
    } else if (baseRef === null) {
      baseRef = value;
    } else if (headRef === null) {
      headRef = value;
    } else {
      throw new Error(`unexpected argument: ${value}`);
    }
  }
  return { repo, baseRef, headRef, output, evidenceFile };
}

async function loadEvidence(evidenceFile) {
  if (!evidenceFile) return null;
  const { readFileSync } = await import("node:fs");
  const raw = readFileSync(evidenceFile, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`--evidence-file is not valid JSON: ${error?.message || error}`);
  }
  const validated = validatePreOpenEvidence(parsed);
  if (!validated.ok) throw new Error(`--evidence-file is invalid:\n- ${validated.errors.join("\n- ")}`);
  return validated.evidence;
}

function selfTest() {
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
}

async function main() {
  const { repo, baseRef, headRef, output, evidenceFile } = parseArgs(process.argv.slice(2));
  if (!repo?.includes("/") || !baseRef || !headRef) usageError();
  const input = collectBranchReviewInput(baseRef, headRef);
  const plan = planReviewScope(input);
  const evidence = await loadEvidence(evidenceFile);
  const result = report({ repo, baseRef, headRef, headRefOid: input.headRefOid, ...evaluate(plan, evidence) });
  const json = JSON.stringify(result, null, 2) + "\n";
  process.stdout.write(json);
  if (output) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(output, json, "utf8");
  }
  process.exitCode = result.decision === "ready" ? 0 : result.decision === "blocked" ? 1 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === "--self-test") {
      selfTest();
    } else {
      await main();
    }
  } catch (error) {
    console.error(String(error?.message || error));
    process.exit(2);
  }
}
