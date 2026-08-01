import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

import { routeShippingGithubPrompt } from "./skill-router.mjs";

const REQUIRED_FIELDS = [
  "id",
  "category",
  "invocation",
  "prompt",
  "expected_resources",
  "unnecessary_resources",
  "assertion_ids",
  "scenario",
];

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parseJsonl(path, errors) {
  const source = readFileSync(path, "utf8");
  const rows = [];
  for (const [index, raw] of source.split(/\r?\n/).entries()) {
    if (!raw.trim()) continue;
    try {
      rows.push({ value: JSON.parse(raw), raw, line: index + 1, path });
    } catch (error) {
      errors.push({
        code: "jsonl_parse_error",
        file: path,
        line: index + 1,
        message: String(error?.message || error),
      });
    }
  }
  return rows;
}

function validateCase(row, root, seenIds, errors) {
  const item = row.value;
  for (const field of REQUIRED_FIELDS) {
    if (!(field in item)) {
      errors.push({ code: "missing_field", id: item.id ?? null, field });
    }
  }
  if (!item.id || typeof item.id !== "string") {
    errors.push({ code: "invalid_id", file: row.path, line: row.line });
  } else if (seenIds.has(item.id)) {
    errors.push({ code: "duplicate_id", id: item.id });
  } else {
    seenIds.add(item.id);
  }
  for (const field of [
    "expected_resources",
    "unnecessary_resources",
    "assertion_ids",
  ]) {
    if (!Array.isArray(item[field])) {
      errors.push({ code: "field_not_array", id: item.id, field });
    }
  }
  for (const assertion of item.assertion_ids || []) {
    if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(assertion)) {
      errors.push({ code: "invalid_assertion_id", id: item.id, assertion });
    }
  }
  for (const resource of item.expected_resources || []) {
    if (
      typeof resource === "string" &&
      (resource.includes("/") || resource.endsWith(".md")) &&
      !existsSync(join(root, resource))
    ) {
      errors.push({ code: "missing_expected_resource", id: item.id, resource });
    }
  }
}

function inferredWorkflow(item) {
  if (item.expected_workflow !== undefined) return item.expected_workflow;
  if (!["must-trigger", "routing"].includes(item.category)) return undefined;
  const workflows = (item.expected_resources || []).filter((resource) =>
    /^references\/(fix-pr-bots|watch-pr|re-review-pr|research-issue|create-pr-for-issue|full-review-pr|security-review|status|merge-pr)\.md$/.test(
      resource,
    ),
  );
  return workflows.length === 1 ? workflows[0] : undefined;
}

function validateRoute(item, errors) {
  const expectedWorkflow = inferredWorkflow(item);
  const shouldNotTrigger = item.expected_skill === null;
  if (expectedWorkflow === undefined && !shouldNotTrigger) return null;
  const route = routeShippingGithubPrompt(item.prompt);
  if (shouldNotTrigger) {
    if (route !== null) {
      errors.push({
        code: "unexpected_skill_route",
        id: item.id,
        actualWorkflow: route.workflow,
      });
    }
  } else {
    if (!route) {
      errors.push({ code: "missing_skill_route", id: item.id, expectedWorkflow });
    } else if (route.workflow !== expectedWorkflow) {
      errors.push({
        code: "workflow_mismatch",
        id: item.id,
        expectedWorkflow,
        actualWorkflow: route.workflow,
      });
    }
    if (
      item.expected_mutation_mode !== undefined &&
      route?.mutationMode !== item.expected_mutation_mode
    ) {
      errors.push({
        code: "mutation_mode_mismatch",
        id: item.id,
        expectedMutationMode: item.expected_mutation_mode,
        actualMutationMode: route?.mutationMode ?? null,
      });
    }
  }
  return {
    id: item.id,
    expectedWorkflow: expectedWorkflow ?? null,
    actualWorkflow: route?.workflow ?? null,
    mutationMode: route?.mutationMode ?? null,
  };
}

function validateRegressionLock(regressionRows, lockPath, errors) {
  if (!existsSync(lockPath)) {
    errors.push({ code: "regression_lock_missing", file: lockPath });
    return;
  }
  let lock;
  try {
    lock = JSON.parse(readFileSync(lockPath, "utf8"));
  } catch (error) {
    errors.push({
      code: "regression_lock_parse_error",
      message: String(error?.message || error),
    });
    return;
  }
  const expected = new Map((lock || []).map((row) => [row.id, row.sha256]));
  const actualIds = new Set();
  for (const row of regressionRows) {
    const id = row.value.id;
    actualIds.add(id);
    const locked = expected.get(id);
    if (!locked) {
      errors.push({ code: "regression_not_locked", id });
      continue;
    }
    const actual = sha256(row.raw);
    if (actual !== locked) {
      errors.push({
        code: "regression_hash_mismatch",
        id,
        expected: locked,
        actual,
      });
    }
  }
  for (const id of expected.keys()) {
    if (!actualIds.has(id)) errors.push({ code: "locked_regression_missing", id });
  }
}

export function validateEvalRepository({ root }) {
  const errors = [];
  const evalDir = join(root, "tests", "evals");
  const files = readdirSync(evalDir)
    .filter((name) => name.endsWith(".jsonl"))
    .sort();
  const allRows = [];
  const regressionRows = [];
  for (const name of files) {
    const rows = parseJsonl(join(evalDir, name), errors);
    allRows.push(...rows);
    if (name === "regression-cases.jsonl") regressionRows.push(...rows);
  }

  const seenIds = new Set();
  const routes = [];
  for (const row of allRows) {
    validateCase(row, root, seenIds, errors);
    const route = validateRoute(row.value, errors);
    if (route) routes.push(route);
  }

  validateRegressionLock(
    regressionRows,
    join(evalDir, "regression-lock.json"),
    errors,
  );

  return {
    schemaVersion: 1,
    kind: "shipping-github/offline-eval-report",
    valid: errors.length === 0,
    files: files.map((name) => basename(name)),
    caseCount: allRows.length - regressionRows.length,
    regressionCount: regressionRows.length,
    routeChecks: routes.length,
    routes,
    errors,
  };
}
