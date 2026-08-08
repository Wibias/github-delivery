import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { basename, join, relative, resolve } from "node:path";

const MODULE_BLOCK_RE = /<!-- policy-modules:start -->([\s\S]*?)<!-- policy-modules:end -->/i;
const DEPENDENCY_BLOCK_RE = /<!-- policy-dependencies:start -->([\s\S]*?)<!-- policy-dependencies:end -->/i;
const RULE_DEFINITION_RE = /^###\s+(GD-[A-Z]+-\d{3})\s+—\s+.+$/gm;
const RULE_HEADING_RE = /^###\s+(GD-[^\s]+).*$/gm;
const RULE_REFERENCE_RE = /\bGD-[A-Z]+-\d{3}\b/g;
const POLICY_MODULE_LINE_RE = /^\s*-\s+([a-z0-9-]+)(?:\s+\(when\s+(.+?)\))?\s*$/i;
const BASELINE_SKILL_BYTES = 32_855;
const BASELINE_UNIVERSAL_BYTES = 32_855 + 87_576;
const REQUIRED_REDUCTION = 0.6;

function bytes(value) {
  return Buffer.byteLength(value, "utf8");
}

function readText(path) {
  return readFileSync(path, "utf8");
}

function slash(path) {
  return path.replaceAll("\\", "/");
}

function workflowPathFor(workflow) {
  const value = String(workflow || "").trim().replaceAll("\\", "/");
  if (!value) throw new Error("workflow_required");
  if (value.startsWith("references/") && value.endsWith(".md")) return value;
  if (value.endsWith(".md")) return `references/${value}`;
  return `references/${value}.md`;
}

function modulePathFor(module) {
  if (module === "policy-kernel") return "references/policy-kernel.md";
  if (module === "shared-rules") return "references/shared-rules.md";
  return `references/policy/${module}.md`;
}

function parseListBlock(markdown, expression, label) {
  const match = String(markdown || "").match(expression);
  if (!match) return null;
  const lines = match[1].split(/\r?\n/);
  const entries = [];
  for (const line of lines) {
    if (!line.trim() || /^\s*Policy (?:modules|dependencies):\s*$/i.test(line)) continue;
    const item = line.match(POLICY_MODULE_LINE_RE);
    if (!item) throw new Error(`${label}_declaration_invalid:${line.trim()}`);
    entries.push({ module: item[1], condition: item[2]?.trim() || null });
  }
  return entries;
}

export function parsePolicyModules(markdown) {
  const entries = parseListBlock(markdown, MODULE_BLOCK_RE, "policy_module");
  if (entries === null) throw new Error("policy_modules_declaration_missing");
  return {
    modules: entries.filter((entry) => !entry.condition).map((entry) => entry.module),
    conditionalModules: entries
      .filter((entry) => entry.condition)
      .map((entry) => ({ module: entry.module, condition: entry.condition })),
  };
}

export function parsePolicyDependencies(markdown) {
  const entries = parseListBlock(markdown, DEPENDENCY_BLOCK_RE, "policy_dependency");
  if (entries === null) return [];
  if (entries.some((entry) => entry.condition)) {
    throw new Error("policy_dependency_condition_forbidden");
  }
  return entries.map((entry) => entry.module);
}

function ruleDefinitions(markdown, path, errors = []) {
  const definitions = [];
  const validHeadingIds = new Set();
  for (const match of String(markdown || "").matchAll(RULE_DEFINITION_RE)) {
    validHeadingIds.add(match[1]);
    definitions.push({ id: match[1], path });
  }
  for (const match of String(markdown || "").matchAll(RULE_HEADING_RE)) {
    if (!validHeadingIds.has(match[1])) errors.push(`malformed_rule_id:${match[1]}:${path}`);
  }
  return definitions;
}

function policyModuleNames(root) {
  const dir = join(root, "references", "policy");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md") && statSync(join(dir, name)).isFile())
    .map((name) => basename(name, ".md"))
    .sort();
}

function parseRoutedWorkflowPaths(skill) {
  const routeStart = skill.indexOf("## Route");
  if (routeStart < 0) return [];
  const afterRoute = skill.slice(routeStart + "## Route".length);
  const nextHeading = afterRoute.search(/^##\s+/m);
  const routeSection = nextHeading >= 0 ? afterRoute.slice(0, nextHeading) : afterRoute;
  const paths = new Set();
  for (const match of routeSection.matchAll(/`(references\/[a-z0-9-]+\.md)`/gi)) {
    if (match[1] === "references/shared-rules.md") continue;
    paths.add(match[1]);
  }
  return [...paths].sort();
}

function collectModuleGraph(root, modules, errors) {
  const graph = new Map();
  for (const module of modules) {
    const path = modulePathFor(module);
    const full = join(root, ...path.split("/"));
    if (!existsSync(full)) continue;
    let dependencies = [];
    try {
      dependencies = parsePolicyDependencies(readText(full));
    } catch (error) {
      errors.push(`${error.message}:${path}`);
    }
    for (const dependency of dependencies) {
      if (dependency === "policy-kernel") continue;
      if (!modules.includes(dependency)) errors.push(`policy_module_missing:${dependency}:${path}`);
    }
    graph.set(module, dependencies.filter((dependency) => dependency !== "policy-kernel"));
  }
  return graph;
}

function detectCycles(graph, errors) {
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  function visit(node) {
    if (visiting.has(node)) {
      const start = stack.indexOf(node);
      errors.push(`policy_dependency_cycle:${[...stack.slice(start), node].join("->")}`);
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    stack.push(node);
    for (const dependency of graph.get(node) || []) visit(dependency);
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  }
  for (const node of [...graph.keys()].sort()) visit(node);
}

function transitiveModules(graph, roots) {
  const reached = new Set();
  function visit(module) {
    if (reached.has(module)) return;
    reached.add(module);
    for (const dependency of graph.get(module) || []) visit(dependency);
  }
  for (const root of roots) visit(root);
  return reached;
}

export function resolvePolicyBundle({ root = process.cwd(), workflow } = {}) {
  const repositoryRoot = resolve(root);
  const workflowPath = workflowPathFor(workflow);
  const workflowFull = join(repositoryRoot, ...workflowPath.split("/"));
  if (!existsSync(workflowFull)) throw new Error(`workflow_missing:${workflowPath}`);
  const workflowText = readText(workflowFull);
  const declaration = parsePolicyModules(workflowText);
  if (!declaration.modules.includes("policy-kernel")) {
    throw new Error("policy_kernel_required");
  }

  const kernelPath = modulePathFor("policy-kernel");
  const kernelFull = join(repositoryRoot, ...kernelPath.split("/"));
  if (!existsSync(kernelFull)) throw new Error("policy_module_missing:policy-kernel");

  const unconditionalNames = declaration.modules.filter((module) => module !== "policy-kernel");
  const conditional = declaration.conditionalModules;
  for (const module of [...unconditionalNames, ...conditional.map((entry) => entry.module)]) {
    const path = modulePathFor(module);
    if (!existsSync(join(repositoryRoot, ...path.split("/")))) {
      throw new Error(`policy_module_missing:${module}`);
    }
  }

  const allModuleNames = policyModuleNames(repositoryRoot);
  const graphErrors = [];
  const graph = collectModuleGraph(repositoryRoot, allModuleNames, graphErrors);
  if (graphErrors.length) throw new Error(graphErrors[0]);
  const expanded = transitiveModules(graph, unconditionalNames);
  const moduleNames = [...expanded].sort();
  const modulePaths = moduleNames.map(modulePathFor);

  const ruleIds = new Set();
  for (const path of [kernelPath, ...modulePaths]) {
    const text = readText(join(repositoryRoot, ...path.split("/")));
    for (const definition of ruleDefinitions(text, path)) ruleIds.add(definition.id);
  }

  const workflowBytes = bytes(workflowText);
  const kernelText = readText(kernelFull);
  const kernelBytes = bytes(kernelText);
  const moduleBytes = Object.fromEntries(
    modulePaths.map((path) => [path, bytes(readText(join(repositoryRoot, ...path.split("/"))))]),
  );

  return {
    workflow: basename(workflowPath, ".md"),
    workflowPath,
    kernelPath,
    modules: modulePaths,
    conditionalModules: conditional.map((entry) => ({
      module: entry.module,
      path: modulePathFor(entry.module),
      condition: entry.condition,
    })),
    ruleIds: [...ruleIds].sort(),
    bytes: {
      workflow: workflowBytes,
      kernel: kernelBytes,
      modules: moduleBytes,
      total: workflowBytes + kernelBytes + Object.values(moduleBytes).reduce((sum, value) => sum + value, 0),
    },
  };
}

export function validatePolicyArchitecture({
  root = process.cwd(),
  baselineSkillBytes = BASELINE_SKILL_BYTES,
  baselineUniversalBytes = BASELINE_UNIVERSAL_BYTES,
  requiredReduction = REQUIRED_REDUCTION,
} = {}) {
  const repositoryRoot = resolve(root);
  const errors = [];
  const skillPath = join(repositoryRoot, "SKILL.md");
  const kernelPath = join(repositoryRoot, "references", "policy-kernel.md");
  const skill = existsSync(skillPath) ? readText(skillPath) : "";
  const kernel = existsSync(kernelPath) ? readText(kernelPath) : "";
  if (!skill) errors.push("skill_missing:SKILL.md");
  if (!kernel) errors.push("policy_module_missing:policy-kernel");

  const routedPaths = parseRoutedWorkflowPaths(skill);
  const declaredRoots = new Set();
  const runtimeTexts = new Map();
  if (skill) runtimeTexts.set("SKILL.md", skill);
  if (kernel) runtimeTexts.set("references/policy-kernel.md", kernel);

  for (const path of routedPaths) {
    const full = join(repositoryRoot, ...path.split("/"));
    if (!existsSync(full)) {
      errors.push(`routed_workflow_missing:${path}`);
      continue;
    }
    const text = readText(full);
    runtimeTexts.set(path, text);
    let declaration;
    try {
      declaration = parsePolicyModules(text);
    } catch (error) {
      errors.push(`${error.message}:${path}`);
      continue;
    }
    if (!declaration.modules.includes("policy-kernel")) {
      errors.push(`policy_kernel_required:${path}`);
    }
    for (const module of [
      ...declaration.modules.filter((value) => value !== "policy-kernel"),
      ...declaration.conditionalModules.map((entry) => entry.module),
    ]) {
      if (module === "shared-rules") {
        errors.push(`shared_rules_dependency_forbidden:${path}`);
        continue;
      }
      const modulePath = modulePathFor(module);
      if (!existsSync(join(repositoryRoot, ...modulePath.split("/")))) {
        errors.push(`policy_module_missing:${module}:${path}`);
      } else {
        declaredRoots.add(module);
      }
    }
  }

  const modules = policyModuleNames(repositoryRoot);
  const graph = collectModuleGraph(repositoryRoot, modules, errors);
  detectCycles(graph, errors);
  const reached = transitiveModules(graph, [...declaredRoots]);
  for (const module of modules) {
    const path = modulePathFor(module);
    const text = readText(join(repositoryRoot, ...path.split("/")));
    runtimeTexts.set(path, text);
    if (!reached.has(module)) errors.push(`orphan_policy_module:${module}`);
  }

  const sharedPath = join(repositoryRoot, "references", "shared-rules.md");
  if (existsSync(sharedPath)) runtimeTexts.set("references/shared-rules.md", readText(sharedPath));

  const definitions = new Map();
  for (const [path, text] of runtimeTexts) {
    for (const definition of ruleDefinitions(text, path, errors)) {
      const prior = definitions.get(definition.id);
      if (prior) errors.push(`duplicate_rule_id:${definition.id}:${prior}:${path}`);
      else definitions.set(definition.id, path);
    }
  }

  for (const [path, text] of runtimeTexts) {
    const definitionIds = new Set(ruleDefinitions(text, path).map((entry) => entry.id));
    for (const match of text.matchAll(RULE_REFERENCE_RE)) {
      const id = match[0];
      if (definitionIds.has(id)) continue;
      if (!definitions.has(id)) errors.push(`unknown_rule_reference:${id}:${path}`);
    }
  }

  const skillBytes = bytes(skill);
  const kernelBytes = bytes(kernel);
  const universalBytes = skillBytes + kernelBytes;
  const skillReduction = baselineSkillBytes > 0 ? 1 - skillBytes / baselineSkillBytes : 0;
  const universalReduction = baselineUniversalBytes > 0 ? 1 - universalBytes / baselineUniversalBytes : 0;
  if (skillReduction < requiredReduction) {
    errors.push(`skill_size_budget_exceeded:${skillBytes}:${baselineSkillBytes}:${requiredReduction}`);
  }
  if (universalReduction < requiredReduction) {
    errors.push(
      `universal_size_budget_exceeded:${universalBytes}:${baselineUniversalBytes}:${requiredReduction}`,
    );
  }

  const metrics = {
    skillBytes,
    kernelBytes,
    universalBytes,
    skillReduction,
    universalReduction,
    routedWorkflows: routedPaths.length,
    moduleCount: modules.length,
    ruleCount: definitions.size,
  };

  return { valid: errors.length === 0, errors: [...new Set(errors)].sort(), metrics };
}

export function repositoryRelative(path, root = process.cwd()) {
  return slash(relative(resolve(root), resolve(path)));
}
