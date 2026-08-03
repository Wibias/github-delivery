#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { validateRepositoryPolicy, validateWorkflowTree } from "./lib/workflow-security.mjs";

const root = resolve(process.argv[2] || process.cwd());
const workflowReport = validateWorkflowTree(root);
const policy = JSON.parse(readFileSync(join(root, ".github", "repository-policy.json"), "utf8"));
const policyErrors = validateRepositoryPolicy(policy);
const report = {
  schemaVersion: 1,
  kind: "github-delivery/repository-security-report",
  valid: workflowReport.valid && policyErrors.length === 0,
  workflows: workflowReport,
  repositoryPolicy: { valid: policyErrors.length === 0, errors: policyErrors },
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.valid) process.exitCode = 1;
