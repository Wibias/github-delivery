import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  parsePolicyDependencies,
  resolvePolicyBundle,
} from "./policy-bundle.mjs";

const TERMINAL = Object.freeze({ DONE: [] });

const ISSUE_GRAPH = Object.freeze({
  ROUTE: ["PREFLIGHT"],
  PREFLIGHT: ["DRAFT", "DONE"],
  DRAFT: ["VERIFY"],
  VERIFY: ["PUBLISH", "DONE"],
  PUBLISH: ["FINAL_GATE"],
  FINAL_GATE: ["DONE"],
  ...TERMINAL,
});

const REVIEW_GRAPH = Object.freeze({
  ROUTE: ["PREFLIGHT"],
  PREFLIGHT: ["ANALYZE", "DONE"],
  ANALYZE: ["APPLY_FIXES", "VERIFY"],
  APPLY_FIXES: ["VERIFY"],
  VERIFY: ["CI", "FINAL_GATE"],
  CI: ["FINAL_GATE"],
  FINAL_GATE: ["PUBLISH_VERDICT", "DONE"],
  PUBLISH_VERDICT: ["DONE"],
  ...TERMINAL,
});

const CREATE_PR_GRAPH = Object.freeze({
  ROUTE: ["PREFLIGHT"],
  PREFLIGHT: ["IMPLEMENT", "EXISTING_PR", "DONE"],
  IMPLEMENT: ["LOCAL_VERIFY"],
  EXISTING_PR: ["REVIEW_FEEDBACK", "LOCAL_VERIFY"],
  LOCAL_VERIFY: ["PREOPEN_GATE", "REVIEW_FEEDBACK"],
  PREOPEN_GATE: ["OPEN_PR", "REVIEW_FEEDBACK"],
  OPEN_PR: ["REVIEW_FEEDBACK"],
  REVIEW_FEEDBACK: ["CI", "FINAL_GATE"],
  CI: ["FINAL_GATE"],
  FINAL_GATE: ["DONE"],
  ...TERMINAL,
});

const LOCAL_PR_GRAPH = Object.freeze({
  ROUTE: ["PREFLIGHT"],
  PREFLIGHT: ["LOCAL_VERIFY", "DONE"],
  LOCAL_VERIFY: ["PREOPEN_GATE"],
  PREOPEN_GATE: ["OPEN_PR"],
  OPEN_PR: ["REVIEW_FEEDBACK"],
  REVIEW_FEEDBACK: ["CI", "FINAL_GATE"],
  CI: ["FINAL_GATE"],
  FINAL_GATE: ["DONE"],
  ...TERMINAL,
});

const WATCH_GRAPH = Object.freeze({
  ROUTE: ["PREFLIGHT"],
  PREFLIGHT: ["WATCH", "DONE"],
  WATCH: ["FINAL_GATE", "BLOCKED", "DONE"],
  FINAL_GATE: ["WATCH", "DONE"],
  BLOCKED: ["DONE"],
  ...TERMINAL,
});

const RESEARCH_GRAPH = Object.freeze({
  ROUTE: ["PREFLIGHT"],
  PREFLIGHT: ["RESEARCH", "DONE"],
  RESEARCH: ["VERIFY"],
  VERIFY: ["PUBLISH", "DONE"],
  PUBLISH: ["DONE"],
  ...TERMINAL,
});

const STATUS_GRAPH = Object.freeze({
  ROUTE: ["PREFLIGHT"],
  PREFLIGHT: ["SNAPSHOT"],
  SNAPSHOT: ["FINAL_GATE", "REPORT"],
  FINAL_GATE: ["REPORT"],
  REPORT: ["DONE"],
  ...TERMINAL,
});

const OPEN_WORK_GRAPH = Object.freeze({
  ROUTE: ["PREFLIGHT"],
  PREFLIGHT: ["SNAPSHOT", "DONE"],
  SNAPSHOT: ["REPORT"],
  REPORT: ["DONE"],
  ...TERMINAL,
});

const WORK_ITEM_GRAPH = Object.freeze({
  ROUTE: ["PREFLIGHT"],
  PREFLIGHT: ["RESOLVE", "DONE"],
  RESOLVE: ["SNAPSHOT", "DONE"],
  SNAPSHOT: ["DELIVER", "REPORT"],
  DELIVER: ["VERIFY"],
  VERIFY: ["RECONCILE", "REPORT"],
  RECONCILE: ["REPORT"],
  REPORT: ["DONE"],
  ...TERMINAL,
});

const CONSOLIDATE_GRAPH = Object.freeze({
  ROUTE: ["PREFLIGHT"],
  PREFLIGHT: ["COLLECT", "DONE"],
  COLLECT: ["ANALYZE"],
  ANALYZE: ["REPORT"],
  REPORT: ["DONE"],
  ...TERMINAL,
});

const MULTI_BASE_GRAPH = Object.freeze({
  ROUTE: ["PREFLIGHT"],
  PREFLIGHT: ["PLAN", "DONE"],
  PLAN: ["APPLY"],
  APPLY: ["LOCAL_VERIFY"],
  LOCAL_VERIFY: ["PUBLISH", "DONE"],
  PUBLISH: ["VERIFY_PORTS"],
  VERIFY_PORTS: ["FINAL_GATE", "DONE"],
  FINAL_GATE: ["DONE"],
  ...TERMINAL,
});

const MERGE_GRAPH = Object.freeze({
  ROUTE: ["PREFLIGHT"],
  PREFLIGHT: ["PREPARE", "DONE"],
  PREPARE: ["FINAL_GATE"],
  FINAL_GATE: ["MERGE", "DONE"],
  MERGE: ["VERIFY"],
  VERIFY: ["DONE"],
  ...TERMINAL,
});

const APPROVE_GRAPH = Object.freeze({
  ROUTE: ["PREFLIGHT"],
  PREFLIGHT: ["APPROVE", "DONE"],
  APPROVE: ["VERIFY"],
  VERIFY: ["DONE"],
  ...TERMINAL,
});

const LOCAL_PREP_GRAPH = Object.freeze({
  ROUTE: ["PREFLIGHT"],
  PREFLIGHT: ["PREPARE", "DONE"],
  PREPARE: ["VERIFY"],
  VERIFY: ["DONE"],
  ...TERMINAL,
});

const CHANGE_GRAPH = Object.freeze({
  ROUTE: ["PREFLIGHT"],
  PREFLIGHT: ["PREPARE", "DONE"],
  PREPARE: ["PUBLISH_CHANGE", "VERIFY"],
  PUBLISH_CHANGE: ["VERIFY"],
  VERIFY: ["FINAL_GATE", "DONE"],
  FINAL_GATE: ["DONE"],
  ...TERMINAL,
});

const CONFLICT_GRAPH = Object.freeze({
  ROUTE: ["PREFLIGHT"],
  PREFLIGHT: ["RESOLVE", "DONE"],
  RESOLVE: ["LOCAL_VERIFY"],
  LOCAL_VERIFY: ["CI", "FINAL_GATE"],
  CI: ["FINAL_GATE"],
  FINAL_GATE: ["DONE"],
  ...TERMINAL,
});

const STACK_GRAPH = Object.freeze({
  ROUTE: ["PREFLIGHT"],
  PREFLIGHT: ["TOPOLOGY", "DONE"],
  TOPOLOGY: ["RESTACK", "VERIFY"],
  RESTACK: ["VERIFY"],
  VERIFY: ["FINAL_GATE", "DONE"],
  FINAL_GATE: ["DONE"],
  ...TERMINAL,
});

const PREPARE_MERGE_GRAPH = Object.freeze({
  ROUTE: ["PREFLIGHT"],
  PREFLIGHT: ["PREPARE", "DONE"],
  PREPARE: ["ANALYZE"],
  ANALYZE: ["APPLY_FIXES", "VERIFY"],
  APPLY_FIXES: ["VERIFY"],
  VERIFY: ["CI", "FINAL_GATE"],
  CI: ["FINAL_GATE"],
  FINAL_GATE: ["MERGE", "DONE"],
  MERGE: ["VERIFY_MERGE"],
  VERIFY_MERGE: ["DONE"],
  ...TERMINAL,
});

const PROFILE_DEFINITIONS = Object.freeze({
  "issue-workflows": { graph: ISSUE_GRAPH, mutation: "profile-dependent" },
  "agent-brief": { graph: ISSUE_GRAPH, mutation: "profile-dependent" },
  "out-of-scope": { graph: ISSUE_GRAPH, mutation: "profile-dependent" },
  "git-workflow": { graph: LOCAL_PREP_GRAPH, mutation: "profile-dependent" },
  "versioning-release": { graph: LOCAL_PREP_GRAPH, mutation: "profile-dependent" },
  "fix-pr-bots": { graph: REVIEW_GRAPH, mutation: "review" },
  "watch-pr": { graph: WATCH_GRAPH, mutation: "read-mostly" },
  "re-review-pr": { graph: REVIEW_GRAPH, mutation: "review" },
  "research-issue": { graph: RESEARCH_GRAPH, mutation: "read-mostly" },
  "create-pr-from-local-work": { graph: LOCAL_PR_GRAPH, mutation: "maintainer" },
  "create-pr-for-issue": { graph: CREATE_PR_GRAPH, mutation: "maintainer" },
  "open-work-status": { graph: OPEN_WORK_GRAPH, mutation: "read-only" },
  "work-item-delivery": { graph: WORK_ITEM_GRAPH, mutation: "profile-dependent" },
  "consolidate-prs": { graph: CONSOLIDATE_GRAPH, mutation: "read-only" },
  "multi-base-delivery": { graph: MULTI_BASE_GRAPH, mutation: "maintainer" },
  "full-review-pr": { graph: REVIEW_GRAPH, mutation: "review" },
  "spec-standards-review": { graph: REVIEW_GRAPH, mutation: "review" },
  "simplify-pr": { graph: REVIEW_GRAPH, mutation: "maintainer" },
  "security-review": { graph: REVIEW_GRAPH, mutation: "review" },
  status: { graph: STATUS_GRAPH, mutation: "read-only" },
  "approve-pr": { graph: APPROVE_GRAPH, mutation: "review" },
  "merge-pr": { graph: MERGE_GRAPH, mutation: "maintainer" },
  "supersede-pr": { graph: CHANGE_GRAPH, mutation: "maintainer" },
  "overtake-pr": { graph: CHANGE_GRAPH, mutation: "maintainer" },
  "resolve-conflicts": { graph: CONFLICT_GRAPH, mutation: "maintainer" },
  "stacked-prs": { graph: STACK_GRAPH, mutation: "profile-dependent" },
  "prepare-and-merge-pr": { graph: PREPARE_MERGE_GRAPH, mutation: "maintainer" },
});

function normalizeWorkflow(value) {
  let workflow = String(value || "").trim().replaceAll("\\", "/");
  if (workflow.startsWith("references/")) workflow = workflow.slice("references/".length);
  if (workflow.endsWith(".md")) workflow = workflow.slice(0, -3);
  return workflow;
}

function copyGraph(graph) {
  return Object.fromEntries(Object.entries(graph).map(([phase, targets]) => [phase, [...targets]]));
}

export function listDeliveryWorkflowProfiles() {
  return Object.entries(PROFILE_DEFINITIONS)
    .map(([workflow, definition]) => ({
      workflow,
      workflowPath: `references/${workflow}.md`,
      startPhase: "ROUTE",
      mutation: definition.mutation,
      graph: copyGraph(definition.graph),
    }))
    .sort((a, b) => a.workflow.localeCompare(b.workflow));
}

export function resolveDeliveryWorkflowProfile(value) {
  const workflow = normalizeWorkflow(value);
  const definition = PROFILE_DEFINITIONS[workflow];
  if (!definition) throw new Error(`unknown delivery workflow: ${workflow || "(empty)"}`);
  return {
    workflow,
    workflowPath: `references/${workflow}.md`,
    startPhase: "ROUTE",
    mutation: definition.mutation,
    graph: copyGraph(definition.graph),
  };
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function document(root, path) {
  const content = readFileSync(join(root, ...path.split("/")), "utf8");
  return { path, sha256: hash(content), content };
}

function dependencyPath(name) {
  if (name === "policy-kernel") return "references/policy-kernel.md";
  return `references/policy/${name}.md`;
}

function addDocumentWithDependencies(root, path, documents, seen) {
  if (seen.has(path)) return;
  const item = document(root, path);
  seen.add(path);
  documents.push(item);
  if (!path.startsWith("references/policy/") || !path.endsWith(".md")) return;
  for (const dependency of parsePolicyDependencies(item.content)) {
    addDocumentWithDependencies(root, dependencyPath(dependency), documents, seen);
  }
}

export function buildWorkflowPacket({
  root = process.cwd(),
  workflow,
  activeConditionalModules = [],
} = {}) {
  const repositoryRoot = resolve(root);
  const profile = resolveDeliveryWorkflowProfile(workflow);
  const policy = resolvePolicyBundle({ root: repositoryRoot, workflow: profile.workflow });
  const allowedConditional = new Map(
    policy.conditionalModules.map((entry) => [entry.module, entry.path]),
  );
  const active = [...new Set(activeConditionalModules.map(String))].sort();
  for (const module of active) {
    if (!allowedConditional.has(module)) {
      throw new Error(`conditional policy module is not declared for ${profile.workflow}: ${module}`);
    }
  }

  const documents = [];
  const seen = new Set();
  addDocumentWithDependencies(repositoryRoot, profile.workflowPath, documents, seen);
  addDocumentWithDependencies(repositoryRoot, policy.kernelPath, documents, seen);
  for (const path of policy.modules) addDocumentWithDependencies(repositoryRoot, path, documents, seen);
  for (const module of active) {
    addDocumentWithDependencies(repositoryRoot, allowedConditional.get(module), documents, seen);
  }

  const packetHash = hash(
    documents.map((item) => `${item.path}\0${item.sha256}`).join("\n"),
  );
  return {
    schemaVersion: 1,
    kind: "github-delivery/workflow-packet",
    workflow: profile.workflow,
    profile,
    policy,
    activeConditionalModules: active,
    documents,
    packetHash,
  };
}
