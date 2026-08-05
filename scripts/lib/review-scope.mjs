import { spawnSync } from "node:child_process";

const CODE_RE = /\.(?:[cm]?[jt]sx?|mjs|cjs|py|go|rs|java|kt|rb|php|cs|swift|c|cc|cpp|h|hpp|vue|svelte)$/i;
const DOC_RE = /\.(?:md|txt|rst|adoc)$/i;
const LOCK_RE = /(^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|go\.sum|Gemfile\.lock|composer\.lock)$/i;
const MANIFEST_RE = /(^|\/)(?:package\.json|Cargo\.toml|go\.mod|pyproject\.toml|requirements[^/]*\.txt|Gemfile|composer\.json)$/i;

const DOMAIN_SPECS = [
  ["authn", "security", /auth|session|login|oauth|jwt|passport|credential/i, /authenticate|login|logout|session|oauth|jwt|bearer|password|passkey|webauthn|cookie|token/i],
  ["authz", "security", /authz|acl|rbac|permission|policy|admin|owner|access/i, /authorize|permission|role|scope|isAdmin|canAccess|requireOwner|requireAdmin|policy/i],
  ["secrets_config", "security", /\.env|secret|credential|token|api[_-]?key|config|provider/i, /secret|credential|api[_-]?key|process\.env|os\.environ|vault|token/i],
  ["injection", "security", /sql|query|template|render|markdown|html|exec|spawn|shell|parser/i, /eval\(|exec\(|spawn\(|child_process|shell\s*:\s*true|innerHTML|dangerouslySetInnerHTML|SELECT\s|INSERT\s|template/i],
  ["ssrf_outbound", "security", /outbound|proxy|fetch|http|destination|provider/i, /fetch\(|axios|undici|http\.request|https\.request|baseUrl|destination|allowPrivateNetwork/i],
  ["uploads_files", "security", /upload|multipart|file|filesystem|storage|path/i, /multipart|multer|upload|readFile|writeFile|path\.join|open\(/i],
  ["webhooks_payments", "security", /webhook|stripe|billing|payment|subscription|refund/i, /webhook|stripe|payment|billing|subscription|refund|signature/i],
  ["ci_actions", "security", /^\.github\/(?:workflows|actions)\//i, /permissions:|pull_request_target|uses:|persist-credentials|secrets\./i],
  ["supply_chain", "security", /package|lock|Cargo|go\.mod|requirements|Gemfile|composer/i, /dependencies|devDependencies|scripts|postinstall|preinstall|git\+|https:\/\//i],
  ["logging_privacy", "security", /log|telemetry|analytics|sentry|privacy|pii|audit/i, /logger|console\.|telemetry|analytics|sentry|email|phone|address|redact|PII/i],
  ["ai_agent_mcp", "security", /prompt|llm|openai|anthropic|mcp|agent|rag|embedding|tool/i, /prompt|tool_call|toolUse|mcp|model|embedding|system message|assistant/i],
  ["agentic_skills_supply_chain", "security", /(^|\/)(?:SKILL\.md|skills\/|plugins\/|mcp\.json|\.mcp\.json|claude_desktop_config\.json)/i, /allowed-tools|mcpServers|references\/|scripts\/|prompt injection/i],
  ["crypto_session", "security", /crypto|cipher|encrypt|decrypt|hash|jwt|cookie|tls|cert|hmac/i, /createHash|createHmac|encrypt|decrypt|jwt|cookie|SameSite|HttpOnly|TLS/i],
  ["business_logic", "security", /workflow|state|entitlement|checkout|subscription|transfer|refund|billing|quota/i, /state machine|entitlement|quota|transfer|refund|idempot|TOCTOU|compare-and-swap/i],
  ["iac_docker", "security", /Dockerfile|docker-compose|\.tf$|helm|charts|kubernetes|k8s|infra|deploy/i, /FROM\s|USER\s|privileged|cap_add|hostNetwork|iam|securityContext/i],
  ["data_storage", "security", /database|db|migration|schema|storage|repository/i, /transaction|migration|schema|database|INSERT|UPDATE|DELETE|commit\(|rollback/i],
  ["api_compatibility", "quality", /api|route|controller|handler|schema|types?|exports?/i, /export\s|public\s|route|endpoint|status\(|response|schema|breaking/i],
];

const LENS_SPECS = [
  ["error_propagation", /catch|finally|throw|reject|error|Result<|panic|except/i],
  ["resource_lifecycle", /close\(|destroy\(|dispose|cleanup|teardown|socket|stream|worker|timer|interval|file handle/i],
  ["concurrency_races", /mutex|lock|semaphore|atomic|worker|thread|Promise\.all|parallel|concurr|race|queue/i],
  ["retry_idempotency", /retry|backoff|idempot|dedup|nonce|requestId|operationId/i],
  ["filesystem_atomicity", /writeFile|rename|temp|mkdtemp|unlink|fsync|atomic/i],
  ["network_cancellation", /fetch\(|http|axios|undici|AbortController|timeout|cancel/i],
  ["parsing_serialization", /JSON\.parse|JSON\.stringify|yaml|toml|csv|parse|serialize|deserialize|regex|RegExp/i],
  ["time_clocks", /Date\.|new Date|clock|timer|timeout|timezone|UTC|duration|expires|ttl/i],
  ["state_consistency", /transaction|state|cache|persist|commit|rollback|compare-and-swap|version/i],
  ["ui_async_state", /useEffect|useState|setState|watch\(|onMounted|componentWill|loading|pending/i],
  ["api_compatibility", /export\s|public\s|endpoint|route|response|schema|version|deprecated/i],
  ["boundary_conditions", /length|size|limit|empty|null|undefined|overflow|underflow|slice|index/i],
];

const REMOVED_CONTROL_RE = /auth|authoriz|permission|middleware|csrf|sanitize|escape|rate.?limit|acl|rbac|requireAuth|requireAdmin|canAccess|validate|verify|HttpOnly|SameSite|allowlist|denylist|private.?network|idempot|lock|transaction/i;

function patchLines(patch = "") {
  const added = [];
  const removed = [];
  for (const line of String(patch).split(/\r?\n/)) {
    if (line.startsWith("+") && !line.startsWith("+++")) added.push(line.slice(1));
    else if (line.startsWith("-") && !line.startsWith("---")) removed.push(line.slice(1));
  }
  return { added, removed };
}

function confidence(score) {
  return score >= 6 ? "high" : score >= 3 ? "medium" : "low";
}

function addEvidence(map, id, category, score, reason, file, excerpt = null) {
  const entry = map.get(id) || { id, category, score: 0, reasons: [], files: new Set(), excerpts: [] };
  entry.score += score;
  if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
  entry.files.add(file);
  if (excerpt && entry.excerpts.length < 8) entry.excerpts.push(excerpt.slice(0, 180));
  map.set(id, entry);
}

function extractSymbols(path, text) {
  const patterns = CODE_RE.test(path) ? [
    /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /\bclass\s+([A-Za-z_$][\w$]*)/g,
    /\b(?:def|func|fn)\s+([A-Za-z_][\w]*)/g,
    /\b(?:interface|type|struct|enum)\s+([A-Za-z_$][\w$]*)/g,
  ] : [];
  const symbols = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (!symbols.includes(match[1])) symbols.push(match[1]);
      if (symbols.length >= 30) return symbols;
    }
  }
  return symbols;
}

function workflowSignals(path, added, removed, evidence) {
  if (!/^\.github\/workflows\//.test(path)) return [];
  const changes = [];
  const pairs = [
    ["pull_request_target", /pull_request_target\s*:/i, 6],
    ["write_permissions", /(?:contents|actions|checks|pull-requests|issues|security-events|id-token):\s*write/i, 5],
    ["persisted_checkout_credentials", /persist-credentials:\s*true/i, 5],
    ["unpinned_action", /uses:\s+[^\s@]+@(?![0-9a-f]{40}\b)[^\s#]+/i, 4],
  ];
  for (const [name, regex, weight] of pairs) {
    const hits = added.filter((line) => regex.test(line));
    if (hits.length) {
      addEvidence(evidence, "ci_actions", "security", weight, `workflow adds ${name}`, path, hits[0]);
      changes.push({ type: name, direction: "added", lines: hits.slice(0, 4) });
    }
  }
  const removedRestrictions = removed.filter((line) => /permissions:|persist-credentials:\s*false|environment:|if:.*github\.event/i.test(line));
  if (removedRestrictions.length) {
    addEvidence(evidence, "ci_actions", "security", 6, "workflow removes a security restriction", path, removedRestrictions[0]);
    changes.push({ type: "restriction_removed", direction: "removed", lines: removedRestrictions.slice(0, 4) });
  }
  return changes;
}

function normalizeFile(file) {
  return {
    path: file.path || file.filename,
    previousPath: file.previousPath || file.previous_filename || null,
    status: file.status || "modified",
    patch: file.patch || "",
    additions: Number(file.additions || 0),
    deletions: Number(file.deletions || 0),
  };
}

export function planReviewScope(input = {}) {
  const files = (input.files || []).map(normalizeFile).filter((file) => file.path);
  const evidence = new Map();
  const lensEvidence = new Map();
  const removedControlLeads = [];
  const workflowPermissionChanges = [];
  const dependencyChanges = [];
  const renamedFiles = [];
  const logicFiles = [];
  const missingPatches = [];

  for (const file of files) {
    const paths = [file.path, file.previousPath].filter(Boolean);
    if (file.previousPath) renamedFiles.push({ from: file.previousPath, to: file.path });
    const { added, removed } = patchLines(file.patch);
    const changedText = [...added, ...removed].join("\n");
    const symbols = extractSymbols(file.path, changedText);
    const isLogic = CODE_RE.test(file.path) || /(^|\/)SKILL\.md$/i.test(file.path) || /^\.github\//.test(file.path);
    if (isLogic) logicFiles.push(file.path);
    if (isLogic && !file.patch && file.status !== "removed") missingPatches.push(file.path);

    for (const [id, category, pathRe, textRe] of DOMAIN_SPECS) {
      if (paths.some((path) => pathRe.test(path))) addEvidence(evidence, id, category, 1, "path signal", file.path);
      const addedHit = added.find((line) => textRe.test(line));
      const removedHit = removed.find((line) => textRe.test(line));
      if (addedHit) addEvidence(evidence, id, category, 2, "added-line signal", file.path, addedHit);
      if (removedHit) addEvidence(evidence, id, category, 3, "removed-line signal", file.path, removedHit);
      if (symbols.some((symbol) => textRe.test(symbol))) addEvidence(evidence, id, category, 1, "changed symbol signal", file.path, symbols.join(", "));
    }

    for (const line of removed) {
      if (REMOVED_CONTROL_RE.test(line)) {
        removedControlLeads.push({ file: file.path, line: line.trim().slice(0, 180) });
        for (const [id, category, , textRe] of DOMAIN_SPECS) {
          if (category === "security" && textRe.test(line)) addEvidence(evidence, id, category, 4, "security control removed", file.path, line);
        }
      }
    }

    workflowPermissionChanges.push(...workflowSignals(file.path, added, removed, evidence));

    if (LOCK_RE.test(file.path) || MANIFEST_RE.test(file.path)) {
      const kind = LOCK_RE.test(file.path) ? "lockfile" : "manifest";
      dependencyChanges.push({ file: file.path, kind, additions: file.additions, deletions: file.deletions });
      addEvidence(evidence, "supply_chain", "security", 3, `${kind} changed`, file.path);
    }

    for (const [id, regex] of LENS_SPECS) {
      const pathHit = regex.test(paths.join("\n"));
      const textHit = added.find((line) => regex.test(line)) || removed.find((line) => regex.test(line));
      if (pathHit) addEvidence(lensEvidence, id, "bug", 1, "path signal", file.path);
      if (textHit) addEvidence(lensEvidence, id, "bug", 3, "changed-line signal", file.path, textHit);
      if (removed.some((line) => regex.test(line))) addEvidence(lensEvidence, id, "bug", 1, "behavior removed", file.path);
    }
  }

  const finalize = (map) => [...map.values()].map((entry) => ({
    ...entry,
    files: [...entry.files].sort(),
    confidence: confidence(entry.score),
    required: entry.score >= 3,
  })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const domains = finalize(evidence);
  const bugLenses = finalize(lensEvidence);
  const requiredSecurity = domains.filter((item) => item.category === "security" && item.required);
  const requiredBug = bugLenses.filter((item) => item.required);
  const docsOnly = files.length > 0 && files.every((file) => DOC_RE.test(file.path) && !/(^|\/)SKILL\.md$/i.test(file.path));
  const criticalSecurity = requiredSecurity.some((item) => item.confidence === "high") || removedControlLeads.length > 0;
  const criticalBug = requiredBug.some((item) => item.confidence === "high");
  const securityDepth = docsOnly ? "skip" : criticalSecurity ? "full" : requiredSecurity.length ? "targeted" : logicFiles.length ? "baseline" : "skip";
  const bugDepth = docsOnly ? "skip" : criticalBug || requiredBug.length >= 2 ? "deep" : requiredBug.length ? "targeted" : logicFiles.length ? "baseline" : "skip";
  const uncertainty = [];
  if (missingPatches.length) uncertainty.push({ code: "patch_missing", files: missingPatches, effect: "Do not downgrade path-only signals below baseline without manual inspection." });
  if (files.length >= 100) uncertainty.push({ code: "large_diff", fileCount: files.length, effect: "Partition review by domain and verify pagination completeness." });

  return {
    schemaVersion: 2,
    kind: "github-delivery/review-scope-plan",
    repo: input.repo || null,
    pr: input.pr || null,
    headRefOid: input.headRefOid || null,
    fileCount: files.length,
    logicFiles,
    renamedFiles,
    removedControlLeads: removedControlLeads.slice(0, 30),
    dependencyChanges,
    workflowPermissionChanges,
    domains,
    bugLenses,
    securityReview: { depth: securityDepth, requiredDomains: requiredSecurity.map((item) => item.id) },
    bugReview: { depth: bugDepth, requiredLenses: requiredBug.map((item) => item.id) },
    baselineScreens: logicFiles.length ? ["authn", "authz", "secrets_config", "injection", "error_propagation", "boundary_conditions"] : [],
    uncertainty,
    complete: uncertainty.length === 0,
    instructions: [
      "Review every high- and medium-confidence required domain; low-confidence signals are residual leads, not findings.",
      "Removed controls and broadened workflow permissions require proof that the original invariant still holds.",
      "Use renamed source and destination paths when interpreting ownership and security boundaries.",
      "Do not skip a domain solely because another review tool reported clean results.",
    ],
  };
}

function gh(args) {
  const result = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(String(result.stderr || result.stdout || "gh failed").trim());
  return String(result.stdout || "").trim();
}

export function collectPrReviewInput(repo, pr) {
  const meta = JSON.parse(gh(["pr", "view", String(pr), "--repo", repo, "--json", "url,baseRefName,headRefOid,headRefName"]));
  const pages = JSON.parse(gh(["api", `repos/${repo}/pulls/${pr}/files?per_page=100`, "--method", "GET", "--paginate", "--slurp"]));
  return { repo, pr, ...meta, files: pages.flat() };
}

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(String(result.stderr || result.stdout || "git failed").trim());
  return String(result.stdout || "").trim();
}

function gitMaybe(args) {
  const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
  if (result.status !== 0) return null;
  return String(result.stdout || "").trim();
}

function resolveRepoForBranch() {
  try {
    const name = JSON.parse(gh(["repo", "view", "--json", "nameWithOwner"])).nameWithOwner;
    if (typeof name === "string" && name.includes("/")) return name;
  } catch {
    // fall through to git remote
  }
  const remote = gitMaybe(["remote", "get-url", "origin"]);
  if (!remote) return null;
  const match = String(remote).match(/(?:[:/])([^/:]+)\/([^/]+?)(?:\.git)?$/);
  return match ? `${match[1]}/${match[2]}` : null;
}

export function collectBranchReviewInput(baseRef, headRef) {
  const nameStatus = git(["diff", "--name-status", `${baseRef}...${headRef}`]);
  const paths = nameStatus.split(/\r?\n/).filter(Boolean).map((line) => {
    const [status, ...rest] = line.split(/\s+/);
    return { status, path: rest.join(" ").replace(/^"|"$/g, "") };
  });
  const files = paths.map(({ status, path }) => {
    const patch = git(["diff", "--no-ext-diff", "--unified=3", `${baseRef}...${headRef}`, "--", path]);
    const added = patch.split(/\r?\n/).filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
    const deleted = patch.split(/\r?\n/).filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
    return { path, status, patch, additions: added, deletions: deleted };
  });
  const headRefOid = gitMaybe(["rev-parse", "--verify", headRef]) || null;
  return { repo: resolveRepoForBranch(), pr: null, headRefOid, files };
}
