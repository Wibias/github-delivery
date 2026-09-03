#!/usr/bin/env node

import { resolve } from "node:path";

import { isDirectInvocation } from "./lib/direct-invocation.mjs";
import {
  collectBranchReviewInput,
  resolveRemoteBranchHead,
} from "./lib/branch-review-input.mjs";
import {
  createDeliveryWorkflowController,
  readDeliveryWorkflowCheckpoint,
  writeDeliveryWorkflowCheckpoint,
} from "./lib/delivery-workflow-controller.mjs";
import { resolveDeliveryWorkflowProfile } from "./lib/delivery-workflow-profiles.mjs";
import { preOpenHygieneReceipts, validatePreOpenHygieneEvidence } from "./lib/pre-open-hygiene-evidence.mjs";
import { planReviewScope } from "./lib/review-scope.mjs";
import { projectBugScope, projectSecurityScope } from "./lib/review-scope-compat.mjs";
import {
  PRE_OPEN_EVIDENCE_SCHEMA_VERSION,
  evidenceClears,
  validatePreOpenEvidence,
} from "./lib/pre-open-evidence.mjs";
import { validateProbeEvidence } from "./lib/probe-evidence.mjs";

function usageError() {
  throw new Error("Usage: node scripts/pre-open-gate.mjs OWNER/REPO BASE_REF HEAD_REF [--compact] [--output FILE] [--evidence-file FILE] [--hygiene-file FILE] [--checkpoint FILE] [--remote REMOTE] | --self-test");
}

function probeCoverage(plan, evidence) {
  const requiredProbes = plan.requiredProbes || [];
  const errors = validateProbeEvidence(evidence?.probes ?? {}, {
    requiredProbes,
    probeEvidence: plan.probeEvidence || {},
  });
  const errorsByProbe = new Map();
  for (const error of errors) {
    const probeId = error?.probeId || "unknown";
    if (!errorsByProbe.has(probeId)) errorsByProbe.set(probeId, []);
    errorsByProbe.get(probeId).push(error);
  }
  return { requiredProbes, errors, errorsByProbe };
}

export function evaluate(plan, evidence = null) {
  const bugScope = projectBugScope(plan);
  const securityScope = projectSecurityScope(plan);
  const implementationDiffPresent = Number(plan?.fileCount || 0) > 0;
  const lensMap = evidence?.lenses ?? {};
  const surfaceMap = evidence?.surfaces ?? {};
  const reviewEvidenceOptions =
    evidence?.schemaVersion === PRE_OPEN_EVIDENCE_SCHEMA_VERSION
      ? { headSha: plan?.headRefOid }
      : null;
  const clearedByEvidence = [];
  const blockers = [];

  for (const id of bugScope.requiredLenses) {
    const blocker = `bug:requiredLenses:${id}`;
    if (evidenceClears(lensMap, id, reviewEvidenceOptions)) clearedByEvidence.push(blocker);
    else blockers.push(blocker);
  }
  for (const id of securityScope.requiredSurfaces) {
    const blocker = `security:requiredSurfaces:${id}`;
    if (evidenceClears(surfaceMap, id, reviewEvidenceOptions)) clearedByEvidence.push(blocker);
    else blockers.push(blocker);
  }

  const probes = probeCoverage(plan, evidence);
  for (const id of probes.requiredProbes) {
    const blocker = `probe:requiredProbes:${id}`;
    if (probes.errorsByProbe.has(id)) blockers.push(blocker);
    else clearedByEvidence.push(blocker);
  }
  for (const [probeId, errors] of probes.errorsByProbe) {
    if (probes.requiredProbes.includes(probeId)) continue;
    for (const error of errors) {
      blockers.push(`probe:evidence:${error.code}:${probeId}`);
    }
  }

  const complete = implementationDiffPresent && plan.complete && bugScope.complete && securityScope.complete;
  const finalBlockers = implementationDiffPresent
    ? blockers
    : ["workflow:implementation_missing"];
  const decision = !implementationDiffPresent
    ? "blocked"
    : !complete
      ? "unknown"
      : finalBlockers.length
        ? "blocked"
        : "ready";
  return {
    bugScope,
    securityScope,
    requiredProbes: probes.requiredProbes,
    probeEvidenceErrors: probes.errors,
    blockers: finalBlockers,
    clearedByEvidence,
    decision,
    complete,
    implementationDiffPresent,
    evidenceApplied: Boolean(evidence),
  };
}

function report({ repo, baseRef, headRef, baseRefOid, headRefOid, diffIdentity, fileCount, bugScope, securityScope, requiredProbes, probeEvidenceErrors, blockers, clearedByEvidence, decision, complete, implementationDiffPresent, evidenceApplied }) {
  return {
    schemaVersion: 1,
    kind: "github-delivery/pre-open-gate",
    repo,
    baseRef,
    headRef,
    baseRefOid,
    headRefOid,
    diffIdentity,
    fileCount,
    decision,
    complete,
    implementationDiffPresent,
    evidenceApplied,
    bugScope,
    securityScope,
    requiredProbes,
    probeEvidenceErrors,
    blockers,
    clearedByEvidence,
    instructions: [
      "workflow:implementation_missing: this pre-open gate requires a non-empty candidate implementation diff; implement first, then rerun the gate before publication.",
      "decision=blocked: complete every remaining required bug lens, security surface, and deterministic probe on this branch diff (with --evidence-file), fix Confirmed High/Critical findings, then rerun before opening the PR.",
      "decision=unknown: restore complete branch evidence (fetch base, checkout head) and rerun; never open a PR from an incomplete diff.",
      "decision=ready: the non-empty candidate branch diff has no remaining review obligations, or every required lens/surface plus every canonical structured probe-evidence record validates; you may proceed to open the PR.",
    ],
  };
}

function sortedUnique(values) {
  return [...new Set((values || []).map(String).filter(Boolean))].sort();
}

function remainingObligations(blockers = []) {
  const remaining = { lenses: [], surfaces: [], probes: [], other: [] };
  for (const blocker of blockers) {
    const value = String(blocker || "");
    if (value.startsWith("bug:requiredLenses:")) {
      remaining.lenses.push(value.slice("bug:requiredLenses:".length));
    } else if (value.startsWith("security:requiredSurfaces:")) {
      remaining.surfaces.push(value.slice("security:requiredSurfaces:".length));
    } else if (value.startsWith("probe:requiredProbes:")) {
      remaining.probes.push(value.slice("probe:requiredProbes:".length));
    } else {
      remaining.other.push(value);
    }
  }
  return Object.fromEntries(
    Object.entries(remaining).map(([key, values]) => [key, sortedUnique(values)]),
  );
}

function fallbackReviewedFiles(result) {
  return sortedUnique([
    ...(result?.bugScope?.logicFilesSample || []),
    ...(result?.securityScope?.reviewPlan?.logicFiles || []),
  ]);
}

function requirementFiles(files, fallback) {
  const scoped = sortedUnique(files);
  return scoped.length ? scoped : fallback;
}

export function compactPreOpenGateReport(result) {
  const blockers = Array.isArray(result?.blockers) ? result.blockers.map(String) : [];
  const remaining = remainingObligations(blockers);
  const fallback = fallbackReviewedFiles(result);
  const lenses = {};
  for (const id of remaining.lenses) {
    const evidence = result?.bugScope?.lensEvidence?.[id] || {};
    lenses[id] = {
      reviewedFiles: requirementFiles(evidence.files, fallback),
      ...(Array.isArray(evidence.reasons) && evidence.reasons.length
        ? { why: evidence.reasons.join("; ") }
        : {}),
    };
  }
  const surfaces = {};
  for (const id of remaining.surfaces) {
    const evidence = result?.securityScope?.matched?.[id] || {};
    surfaces[id] = {
      reviewedFiles: requirementFiles(evidence.files, fallback),
      ...(evidence.why ? { why: String(evidence.why) } : {}),
    };
  }
  const probes = {};
  const probeEvidence = {
    ...(result?.bugScope?.reviewPlan?.probeEvidence || {}),
    ...(result?.securityScope?.reviewPlan?.probeEvidence || {}),
  };
  for (const id of remaining.probes) {
    probes[id] = {
      files: requirementFiles(probeEvidence?.[id]?.files, fallback),
    };
  }

  const nextAction =
    result?.decision === "ready"
      ? "proceed_to_publication"
      : result?.decision === "blocked"
        ? "complete_evidence"
        : "restore_branch_evidence";

  return {
    schemaVersion: 1,
    kind: "github-delivery/pre-open-gate-summary",
    repo: result?.repo,
    baseRef: result?.baseRef,
    headRef: result?.headRef,
    baseRefOid: result?.baseRefOid,
    headRefOid: result?.headRefOid,
    diffIdentity: result?.diffIdentity,
    fileCount: result?.fileCount,
    decision: result?.decision,
    complete: result?.complete,
    implementationDiffPresent: result?.implementationDiffPresent,
    evidenceApplied: result?.evidenceApplied,
    blockerCount: blockers.length,
    remaining,
    evidenceRequirements: {
      schemaVersion: PRE_OPEN_EVIDENCE_SCHEMA_VERSION,
      headSha: result?.headRefOid,
      lenses,
      surfaces,
      probes,
    },
    clearedCount: Array.isArray(result?.clearedByEvidence) ? result.clearedByEvidence.length : 0,
    nextAction,
  };
}

function parseArgs(argv) {
  let repo = null;
  let baseRef = null;
  let headRef = null;
  let output = null;
  let evidenceFile = null;
  let hygieneFile = null;
  let checkpoint = null;
  let remote = "origin";
  let compact = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--compact") {
      compact = true;
    } else if (value === "--output") {
      output = argv[++index];
      if (output === undefined) throw new Error("--output requires a file path");
    } else if (value === "--evidence-file") {
      if (evidenceFile !== null) throw new Error("--evidence-file may be given only once");
      evidenceFile = argv[++index];
      if (evidenceFile === undefined) throw new Error("--evidence-file requires a file path");
    } else if (value === "--hygiene-file") {
      if (hygieneFile !== null) throw new Error("--hygiene-file may be given only once");
      hygieneFile = argv[++index];
      if (hygieneFile === undefined) throw new Error("--hygiene-file requires a file path");
    } else if (value === "--checkpoint") {
      checkpoint = argv[++index];
      if (checkpoint === undefined) throw new Error("--checkpoint requires a file path");
    } else if (value === "--remote") {
      remote = argv[++index];
      if (!remote) throw new Error("--remote requires a remote name");
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
  return { repo, baseRef, headRef, output, evidenceFile, hygieneFile, checkpoint, remote, compact };
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
  if (validated.evidence.schemaVersion !== PRE_OPEN_EVIDENCE_SCHEMA_VERSION) {
    throw new Error(
      `--evidence-file is invalid:\n- evidence schemaVersion must be ${PRE_OPEN_EVIDENCE_SCHEMA_VERSION} for publication`,
    );
  }
  return validated.evidence;
}

async function loadHygieneEvidence(hygieneFile, headSha) {
  if (!hygieneFile) return null;
  const { readFileSync } = await import("node:fs");
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(hygieneFile, "utf8"));
  } catch (error) {
    throw new Error(`--hygiene-file is not valid JSON: ${error?.message || error}`);
  }
  return validatePreOpenHygieneEvidence(parsed, { headSha });
}

function checkpointReviewRefs({ checkpointPath, repo, baseRef, headRef, remote }) {
  if (!checkpointPath) return { base: baseRef, head: headRef, snapshot: null };
  const snapshot = readDeliveryWorkflowCheckpoint(resolve(checkpointPath));
  if (String(snapshot.repo || "").toLowerCase() !== String(repo || "").toLowerCase()) {
    throw new Error("pre_open_checkpoint_repo_mismatch");
  }
  if (snapshot.workflow !== "create-pr-from-local-work") {
    return { base: baseRef, head: headRef, snapshot };
  }
  const remotePrefix = `${remote}/`;
  const branch = String(baseRef).startsWith(remotePrefix)
    ? String(baseRef).slice(remotePrefix.length)
    : String(baseRef);
  const base = resolveRemoteBranchHead(remote, branch);
  const head = String(snapshot.headSha || headRef || "").trim();
  if (!head) throw new Error("pre_open_checkpoint_head_missing");
  return { base, head, snapshot };
}

function persistCheckpoint(checkpointPath, result, hygieneEvidence = null) {
  if (!checkpointPath) return;
  const checkpoint = resolve(checkpointPath);
  const snapshot = readDeliveryWorkflowCheckpoint(checkpoint);
  if (snapshot.headSha && String(snapshot.headSha).toLowerCase() !== String(result.headRefOid || "").toLowerCase()) {
    throw new Error("pre_open_checkpoint_head_changed");
  }
  if (hygieneEvidence) {
    snapshot.hygienePasses = preOpenHygieneReceipts(hygieneEvidence, {
      headSha: result.headRefOid,
    });
  }
  const profile = resolveDeliveryWorkflowProfile(snapshot.workflow);
  const controller = createDeliveryWorkflowController({ snapshot, graph: profile.graph });
  controller.updateRefs(
    snapshot.workflow === "create-pr-from-local-work"
      ? { baseSha: result.baseRefOid, headSha: result.headRefOid }
      : { headSha: result.headRefOid },
  );
  controller.recordPreOpenGate(result);
  writeDeliveryWorkflowCheckpoint(checkpoint, controller.snapshot());
}

function selfTest() {
  const plan = planReviewScope({
    repo: "acme/widget",
    pr: null,
    headRefOid: "abc",
    files: [{ path: "src/worker.ts", patch: "+new Worker(url)\n+worker.terminate()", status: "modified", additions: 2, deletions: 0 }],
  });
  const out = report({ repo: plan.repo, baseRef: "dev", headRef: "feat/x", baseRefOid: "base", headRefOid: plan.headRefOid, diffIdentity: "sha256:test", fileCount: plan.fileCount, ...evaluate(plan) });
  if (out.decision !== "blocked" || !out.blockers.some((b) => b.startsWith("bug:requiredLenses:"))) {
    throw new Error("self-test failed: expected blocked with bug lenses");
  }
  const compact = compactPreOpenGateReport(out);
  if (compact.kind !== "github-delivery/pre-open-gate-summary" || compact.blockerCount === 0) {
    throw new Error("self-test failed: expected compact blocker summary");
  }
  const emptyPlan = planReviewScope({ repo: "acme/widget", pr: null, headRefOid: "base", files: [] });
  const emptyOut = report({ repo: emptyPlan.repo, baseRef: "dev", headRef: "feat/empty", baseRefOid: "base", headRefOid: emptyPlan.headRefOid, diffIdentity: "sha256:empty", fileCount: emptyPlan.fileCount, ...evaluate(emptyPlan) });
  if (emptyOut.decision !== "blocked" || !emptyOut.blockers.includes("workflow:implementation_missing")) {
    throw new Error("self-test failed: expected empty candidate diff to block as implementation_missing");
  }
  process.stdout.write(JSON.stringify({ ok: true, decision: out.decision, blockers: out.blockers, emptyDecision: emptyOut.decision }, null, 2) + "\n");
}

async function main() {
  const { repo, baseRef, headRef, output, evidenceFile, hygieneFile, checkpoint, remote, compact } = parseArgs(process.argv.slice(2));
  if (!repo?.includes("/") || !baseRef || !headRef) usageError();
  const refs = checkpointReviewRefs({ checkpointPath: checkpoint, repo, baseRef, headRef, remote });
  const input = collectBranchReviewInput(refs.base, refs.head);
  const plan = planReviewScope(input);
  const evidence = await loadEvidence(evidenceFile);
  const hygieneEvidence = await loadHygieneEvidence(hygieneFile, input.headRefOid);
  const result = report({
    repo,
    baseRef,
    headRef,
    baseRefOid: input.baseRefOid,
    headRefOid: input.headRefOid,
    diffIdentity: input.diffIdentity,
    fileCount: plan.fileCount,
    ...evaluate(plan, evidence),
  });
  persistCheckpoint(checkpoint, result, hygieneEvidence);
  const emitted = compact ? compactPreOpenGateReport(result) : result;
  const json = JSON.stringify(emitted, null, 2) + "\n";
  process.stdout.write(json);
  if (output) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(output, json, "utf8");
  }
  process.exitCode = result.decision === "ready" ? 0 : result.decision === "blocked" ? 1 : 2;
}

if (isDirectInvocation(import.meta.url)) {
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
