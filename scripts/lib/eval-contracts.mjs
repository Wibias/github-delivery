import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";

import { routeShippingGithubPrompt } from "./skill-router.mjs";
import { KNOWN_LENS_IDS, KNOWN_SECURITY_SURFACE_IDS, planReviewScope } from "./review-scope.mjs";
import {
  ASSERTION_TO_PROBE,
  PROBE_BY_ID,
  PROBE_REGISTRY,
  validateProbeRegistry,
} from "./probe-registry.mjs";

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

function walkMarkdown(root, directory) {
  const files = [];
  for (const name of readdirSync(directory).sort()) {
    const full = join(directory, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...walkMarkdown(root, full));
    } else if (name.endsWith(".md")) {
      files.push(relative(root, full).split(sep).join("/"));
    }
  }
  return files;
}

function collectAssertionMarkers(root) {
  const files = ["SKILL.md"];
  for (const directory of ["references", "overrides"]) {
    const full = join(root, directory);
    if (existsSync(full) && statSync(full).isDirectory()) {
      files.push(...walkMarkdown(root, full));
    }
  }
  const markers = new Map();
  for (const file of files) {
    if (!existsSync(join(root, file))) continue;
    const source = readFileSync(join(root, file), "utf8");
    for (const match of source.matchAll(/<!--\s*assertion:\s*([A-Za-z0-9][A-Za-z0-9-]*)\s*-->/g)) {
      const assertion = match[1];
      if (!markers.has(assertion)) {
        markers.set(assertion, file);
      }
    }
  }
  return { markers };
}

function resolveExpectedResourcePaths(item, root) {
  return (item.expected_resources || []).map((resource) => {
    if (typeof resource !== "string") return null;
    if (resource.endsWith(".md")) return resource;
    return null;
  }).filter((resource) => resource !== null);
}

function validateAssertionBinding(allRows, root, errors, { regressionOnly = false } = {}) {
  const { markers } = collectAssertionMarkers(root);
  const regressionAssertions = new Set();
  for (const row of allRows) {
    if (row.value.category === "regression") {
      for (const assertion of row.value.assertion_ids || []) {
        regressionAssertions.add(assertion);
      }
    }
  }
  const usedAssertions = new Set();
  for (const row of allRows) {
    const item = row.value;
    if (!item.assertion_ids) continue;
    if (regressionOnly && item.category !== "regression") continue;
    for (const assertion of item.assertion_ids) {
      usedAssertions.add(assertion);
      if (markers.has(assertion)) {
        const file = markers.get(assertion);
        const expected = resolveExpectedResourcePaths(item, root);
        const allowed = [file, `references/${basename(file)}`];
        if (!expected.some((resource) => allowed.includes(resource))) {
          errors.push({
            code: "assertion_not_in_expected_resources",
            id: item.id,
            assertion,
            markerFile: file,
            expectedResources: expected,
          });
        }
      } else {
        errors.push({ code: "assertion_not_bound", id: item.id, assertion });
      }
    }
  }
  if (regressionOnly) {
    for (const assertion of markers.keys()) {
      if (regressionAssertions.has(assertion) && !usedAssertions.has(assertion)) {
        errors.push({ code: "assertion_marker_orphan", assertion });
      }
    }
  } else {
    for (const assertion of markers.keys()) {
      if (!usedAssertions.has(assertion)) {
        errors.push({ code: "assertion_marker_orphan", assertion });
      }
    }
  }
  return { markers };
}

function validateScopeCases(scopeRows, root, errors) {
  const registryErrors = validateProbeRegistry(KNOWN_LENS_IDS, KNOWN_SECURITY_SURFACE_IDS);
  for (const error of registryErrors) {
    errors.push({ code: "probe_registry_invalid", ...error });
  }
  const knownProbeIds = new Set(PROBE_REGISTRY.map((probe) => probe.id));
  for (const row of scopeRows) {
    const item = row.value;
    if (!item.id || typeof item.id !== "string") {
      errors.push({ code: "invalid_scope_case_id", file: row.path, line: row.line });
      continue;
    }
    if (!Array.isArray(item.files) || !Array.isArray(item.expected_probes)) {
      errors.push({ code: "scope_case_missing_fields", id: item.id });
      continue;
    }
    for (const probe of item.expected_probes) {
      if (!knownProbeIds.has(probe)) {
        errors.push({ code: "scope_case_unknown_probe", id: item.id, probe });
      }
    }
    let plan;
    try {
      plan = planReviewScope({
        repo: "scope-fixture",
        pr: 1,
        headRefOid: "fixture",
        files: item.files,
      });
    } catch (error) {
      errors.push({
        code: "scope_case_execution_error",
        id: item.id,
        message: String(error?.message || error),
      });
      continue;
    }
    const actual = [...plan.requiredProbes].sort();
    const expected = [...item.expected_probes].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      errors.push({
        code: "scope_case_probe_mismatch",
        id: item.id,
        expected,
        actual,
      });
    }
  }
}

function validateProbeDocBinding(root, errors) {
  // Every probe in the registry must have a `<!-- probe: <id> -->` tag in one
  // of the reference docs, and every assertion the probe declares must be
  // bound to a marker in a doc that also carries that probe's tag.
  const files = ["SKILL.md"];
  for (const directory of ["references", "overrides"]) {
    const full = join(root, directory);
    if (existsSync(full) && statSync(full).isDirectory()) {
      files.push(...walkMarkdown(root, full));
    }
  }
  const docContents = new Map();
  for (const file of files) {
    const full = join(root, file);
    if (!existsSync(full)) continue;
    docContents.set(file, readFileSync(full, "utf8"));
  }
  const probeTags = new Map(); // probe id -> doc
  const assertionMarkers = new Map(); // assertion id -> doc
  for (const [file, source] of docContents) {
    for (const match of source.matchAll(/<!--\s*probe:\s*([A-Za-z0-9][A-Za-z0-9-]*)\s*-->/g)) {
      if (!probeTags.has(match[1])) probeTags.set(match[1], file);
    }
    for (const match of source.matchAll(/<!--\s*assertion:\s*([A-Za-z0-9][A-Za-z0-9-]*)\s*-->/g)) {
      if (!assertionMarkers.has(match[1])) assertionMarkers.set(match[1], file);
    }
  }
  for (const probe of PROBE_REGISTRY) {
    if (!probeTags.has(probe.id)) {
      errors.push({ code: "probe_not_tagged_in_docs", probe: probe.id });
      continue;
    }
    const probeDoc = probeTags.get(probe.id);
    for (const assertion of probe.assertions) {
      if (!assertionMarkers.has(assertion)) {
        errors.push({ code: "probe_assertion_not_bound", probe: probe.id, assertion });
        continue;
      }
      const assertionDoc = assertionMarkers.get(assertion);
      if (assertionDoc !== probeDoc) {
        errors.push({
          code: "probe_assertion_wrong_doc",
          probe: probe.id,
          assertion,
          probeDoc,
          assertionDoc,
        });
      }
    }
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
  const scopeRows = [];
  for (const name of files) {
    const rows = parseJsonl(join(evalDir, name), errors);
    allRows.push(...rows);
    if (name === "regression-cases.jsonl") regressionRows.push(...rows);
    if (name === "scope-cases.jsonl") scopeRows.push(...rows);
  }

  const seenIds = new Set();
  const routes = [];
  for (const row of allRows) {
    if (row.value.category === "scope") continue; // handled by validateScopeCases
    validateCase(row, root, seenIds, errors);
    const route = validateRoute(row.value, errors);
    if (route) routes.push(route);
  }

  validateRegressionLock(
    regressionRows,
    join(evalDir, "regression-lock.json"),
    errors,
  );

  const assertionMarkers = collectAssertionMarkers(root).markers;
  validateAssertionBinding(allRows, root, errors, { regressionOnly: true });
  validateScopeCases(scopeRows, root, errors);
  validateProbeDocBinding(root, errors);

  return {
    schemaVersion: 1,
    kind: "github-delivery/offline-eval-report",
    valid: errors.length === 0,
    files: files.map((name) => basename(name)),
    caseCount: allRows.length - regressionRows.length - scopeRows.length,
    regressionCount: regressionRows.length,
    scopeCaseCount: scopeRows.length,
    probeCount: PROBE_REGISTRY.length,
    regressionAssertionCount: regressionRows.reduce(
      (count, row) => count + (row.value.assertion_ids?.length || 0),
      0,
    ),
    boundAssertionCount: regressionRows.reduce((count, row) => {
      return (
        count +
        (row.value.assertion_ids || []).filter((id) => assertionMarkers.has(id))
          .length
      );
    }, 0),
    routeChecks: routes.length,
    routes,
    errors,
  };
}
