#!/usr/bin/env node
/**
 * Map PR changed files → required security coverage surfaces.
 * Usage: node scripts/security-scope.mjs OWNER/REPO PR_NUMBER
 *        node scripts/security-scope.mjs --self-test
 * Requires: gh auth (except --self-test)
 *
 * Exit 0 always on success (JSON to stdout). Exit 2 on usage/gh error.
 * Agents MUST cover every surface in requiredSurfaces (or justified n/a).
 * If requireAiAgentSecurity: load skill ai-agent-security.
 * If requireAgenticSkillsTop10: load ai-agent-security + references/agentic-skills-top10.md.
 * If lockfilesChanged: run package-manager audit as a lead.
 * If removedControlLeads non-empty: prove controls still exist.
 * Never auto-launch adversarial/red-team second pass (user must ask).
 */
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);

function ghText(args) {
  const r = spawnSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || "").trim();
    throw new Error(err || `gh failed (${r.status})`);
  }
  return (r.stdout || "").trim();
}

function ghJson(args) {
  const out = ghText(args);
  return out ? JSON.parse(out) : null;
}

const REMOVED_CONTROL_RE =
  /auth|authoriz|authenticat|permission|middleware|csrf|sanitize|escape|rate.?limit|acl|rbac|checkOwner|requireAuth|requireAdmin|isAdmin|canAccess|validate|verifier|verifySignature|HttpOnly|SameSite|allowlist|denylist|private.?network|preserveCustomDestination/i;

/**
 * Scan unified diff for removed lines that look like security controls.
 * @param {string} diff
 * @returns {string[]}
 */
function findRemovedControlLines(diff) {
  const leads = [];
  if (!diff) return leads;
  for (const line of diff.split(/\r?\n/)) {
    if (!line.startsWith("-") || line.startsWith("---")) continue;
    const body = line.slice(1);
    if (REMOVED_CONTROL_RE.test(body)) {
      leads.push(body.trim().slice(0, 160));
      if (leads.length >= 20) break;
    }
  }
  return leads;
}

/** @type {Record<string, { test: (f: string) => boolean, why: string }>} */
const RULES = {
  authn: {
    why: "auth/session/token/login surfaces in diff",
    test: (f) =>
      /auth|session|login|oauth|jwt|passport|credent/i.test(f) &&
      !/docs?\//i.test(f),
  },
  authz: {
    why: "authz/ACL/RBAC/permission/admin/management API surfaces",
    test: (f) =>
      /authz|acl|rbac|permission|policy|admin|management|codeowner/i.test(f) ||
      /server\/.*api|\/api\//i.test(f),
  },
  injection: {
    why: "parsers/templates/SQL/shell/HTML rendering paths",
    test: (f) =>
      /sql|query|template|render|markdown|html|exec|spawn|child_process|eval/i.test(
        f,
      ),
  },
  ssrf_outbound: {
    why: "HTTP client / outbound / proxy / destination / fetch paths",
    test: (f) =>
      /outbound|proxy|fetch|http|ssrf|destination|undici|axios|got\./i.test(f) ||
      /provider-outbound|allowPrivateNetwork/i.test(f),
  },
  secrets_config: {
    why: "env/secrets/config/credential files",
    test: (f) =>
      /\.env|secret|credential|token|api[_-]?key|config/i.test(f) ||
      /\/registry\.ts$|providers\//i.test(f),
  },
  uploads_files: {
    why: "upload/multipart/filesystem paths",
    test: (f) => /upload|multipart|multer|filesystem|fs\/|path\.join/i.test(f),
  },
  webhooks_payments: {
    why: "webhook/stripe/billing/payment paths",
    test: (f) => /webhook|stripe|billing|payment|paddle|lemon/i.test(f),
  },
  ci_actions: {
    why: "GitHub Actions / CI workflow changes",
    test: (f) =>
      /^\.github\/workflows\//i.test(f) || /^\.github\/actions\//i.test(f),
  },
  supply_chain: {
    why: "lockfile or package manifest changes",
    test: (f) =>
      /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|go\.sum|Gemfile\.lock|composer\.lock)$/i.test(
        f,
      ),
  },
  logging_privacy: {
    why: "logging/telemetry/analytics paths",
    test: (f) => {
      if (/catalog/i.test(f))
        return /telemetry|analytics|sentry|privacy|[/_.-]pii([/_.-]|$)/i.test(f);
      return (
        /(^|\/)([^/]*log(ger|ging|s)?|telemetry|analytics|sentry)(\/|\.|$)/i.test(
          f,
        ) || /privacy|[/_.-]pii([/_.-]|$)/i.test(f)
      );
    },
  },
  ai_agent_mcp: {
    why: "LLM/agent/MCP/prompt/RAG/tool surfaces — load ai-agent-security",
    test: (f) =>
      /prompt|llm|openai|anthropic|mcp|agent|rag|embedding|tool-call|tool_use|codex|chat/i.test(
        f,
      ),
  },
  agentic_skills_supply_chain: {
    why: "Agent skill package / MCP install config — AST01–10 + ai-agent-security",
    test: (f) => isAgenticSkillOrMcpInstallPath(f),
  },
  credential_destinations: {
    why: "provider presets / baseUrl / OAuth / API key routing",
    test: (f) =>
      /providers\/|baseUrl|oauth|apiKey|preset|catalog|derive\.ts|registry\.ts/i.test(
        f,
      ),
  },
  crypto_session: {
    why: "crypto / JWT / cookie / TLS / hashing surfaces",
    test: (f) =>
      /crypto|cipher|encrypt|decrypt|hash|bcrypt|argon|scrypt|jwt|cookie|tls|cert|keystore|pkcs|hmac/i.test(
        f,
      ),
  },
  business_logic: {
    why: "workflow / entitlement / multi-step / race-prone paths",
    test: (f) =>
      /workflow|state[-_]?machine|entitlement|checkout|subscription|idempoten|toctou|multi[-_]?step|transfer|refund|billing[-_]?state|race|concurrency|lock\.|mutex/i.test(
        f,
      ),
  },
  iac_docker: {
    why: "Dockerfile / compose / K8s / Terraform / Helm infra",
    test: (f) =>
      /(^|\/)Dockerfile(\.|$)/i.test(f) ||
      /(^|\/)docker-compose[^/]*\.(ya?ml)$/i.test(f) ||
      /(^|\/)\.dockerignore$/i.test(f) ||
      /\.(tf|tfvars)$/i.test(f) ||
      /(^|\/)(helm|charts|kubernetes|k8s|deployments?|infra)\//i.test(f) ||
      /cloudformation|cdk\.|pulumi|compose\.ya?ml/i.test(f),
  },
};

const LOCKFILE_RE =
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|go\.sum)$/i;
const MANIFEST_RE = /(^|\/)(package\.json|Cargo\.toml|go\.mod)$/i;

/** Skill packages + MCP install/config paths (OWASP Agentic Skills Top 10). */
function isAgenticSkillOrMcpInstallPath(f) {
  if (/(^|\/)SKILL\.md$/i.test(f)) return true;
  if (/(^|\/)agents\/openai\.yaml$/i.test(f)) return true;
  if (
    /(^|\/)\.(agents|cursor|claude|codex)\/skills\//i.test(f) ||
    /(^|\/)skills\/[^/]+\/(SKILL\.md|scripts\/|references\/|agents\/)/i.test(f) ||
    /(^|\/)plugins\/[^/]+\/skills\//i.test(f)
  ) {
    return true;
  }
  if (
    /(^|\/)(mcp\.json|\.mcp\.json|claude_desktop_config\.json)$/i.test(f) ||
    /(^|\/)\.cursor\/(mcp|mcp\.json)/i.test(f) ||
    /(^|\/)\.vscode\/mcp\.json$/i.test(f) ||
    /mcpServers/i.test(f) ||
    /(^|\/)mcp[_-]?servers?\.(json|ya?ml|toml)$/i.test(f)
  ) {
    return true;
  }
  return false;
}

function pushSurface(requiredSurfaces, matched, key, entry) {
  if (!requiredSurfaces.includes(key)) requiredSurfaces.push(key);
  matched[key] = entry;
}

if (argv[0] === "--self-test") {
  const sample = [
    "--- a/x",
    "+++ b/x",
    "@@",
    "-  if (!requireAuth(req)) return 401;",
    "+  // auth removed",
    "-  const x = 1;",
  ].join("\n");
  const leads = findRemovedControlLines(sample);
  if (!leads.some((l) => /requireAuth/.test(l))) {
    console.error("self-test failed: expected requireAuth lead");
    process.exit(1);
  }
  const iac = RULES.iac_docker.test("deploy/Dockerfile");
  const biz = RULES.business_logic.test("src/checkout/workflow.ts");
  const cryptoOk = RULES.crypto_session.test("lib/jwt-cookie.ts");
  const skillOk = isAgenticSkillOrMcpInstallPath(
    ".agents/skills/shipping-github/SKILL.md",
  );
  const mcpOk = isAgenticSkillOrMcpInstallPath(".cursor/mcp.json");
  const notSkill = !isAgenticSkillOrMcpInstallPath("src/agent/runner.ts");
  if (!iac || !biz || !cryptoOk || !skillOk || !mcpOk || !notSkill) {
    console.error("self-test failed: surface matchers", {
      iac,
      biz,
      cryptoOk,
      skillOk,
      mcpOk,
      notSkill,
    });
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, leads, skillOk, mcpOk }, null, 2));
  process.exit(0);
}

const [repo, prRaw] = argv;
if (!repo || !prRaw || !repo.includes("/")) {
  console.error("Usage: node scripts/security-scope.mjs OWNER/REPO PR_NUMBER");
  console.error("       node scripts/security-scope.mjs --self-test");
  process.exit(2);
}

const pr = Number(prRaw);

try {
  const meta = ghJson([
    "pr",
    "view",
    String(pr),
    "--repo",
    repo,
    "--json",
    "url,baseRefName,headRefOid,headRefName,files",
  ]);

  let files = [];
  if (Array.isArray(meta.files) && meta.files.length) {
    files = meta.files.map((f) => f.path).filter(Boolean);
  } else {
    const listed = ghText([
      "pr",
      "diff",
      String(pr),
      "--repo",
      repo,
      "--name-only",
    ]);
    files = listed.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }

  const matched = {};
  const requiredSurfaces = [];
  for (const [key, rule] of Object.entries(RULES)) {
    const hits = files.filter((f) => rule.test(f));
    if (hits.length) {
      matched[key] = { why: rule.why, files: hits.slice(0, 12) };
      requiredSurfaces.push(key);
    }
  }

  const processSteps = [
    "variant_analysis_if_findings",
    "confidence_high_medium_do_not_flag",
    "removed_controls_on_code_diff",
    "agentic_skills_top10_when_flagged",
    "adversarial_red_team_only_if_user_explicitly_asked",
  ];

  const lockfilesChanged = files.filter((f) => LOCKFILE_RE.test(f));
  const manifestsChanged = files.filter((f) => MANIFEST_RE.test(f));
  const requireDepsAudit =
    lockfilesChanged.length > 0 || manifestsChanged.length > 0;

  let packageManager = null;
  if (requireDepsAudit) {
    const joined = files.join("\n");
    if (/bun\.lockb?|package\.json/i.test(joined))
      packageManager = "bun|npm|pnpm (detect from repo)";
    if (/pnpm-lock\.yaml/i.test(joined)) packageManager = "pnpm";
    else if (/yarn\.lock/i.test(joined)) packageManager = "yarn";
    else if (/package-lock\.json/i.test(joined)) packageManager = "npm";
    else if (/bun\.lockb?/i.test(joined)) packageManager = "bun";
    else if (/Cargo\.(toml|lock)/i.test(joined)) packageManager = "cargo";
    else if (/go\.(mod|sum)/i.test(joined)) packageManager = "go";
  }

  const requireAgenticSkillsTop10 = requiredSurfaces.includes(
    "agentic_skills_supply_chain",
  );
  // Skill/MCP install review always needs ai-agent-security; app LLM paths too
  const requireAiAgentSecurity =
    requiredSurfaces.includes("ai_agent_mcp") || requireAgenticSkillsTop10;

  const alwaysBaseline = ["authn", "authz", "secrets_config", "injection"];
  const codeChanged = files.some((f) =>
    /\.(ts|tsx|js|jsx|mjs|cjs|go|py|rs|java|kt|rb|php)$/i.test(f),
  );
  for (const b of alwaysBaseline) {
    if (codeChanged && !requiredSurfaces.includes(b)) {
      pushSurface(requiredSurfaces, matched, b, {
        why: "baseline for code diffs (may be n/a with justification if surface untouched)",
        files: [],
        baseline: true,
      });
    }
  }

  let removedControlLeads = [];
  let removedControlsScan = "n/a";
  if (codeChanged) {
    removedControlsScan = "manual_required";
    try {
      const diff = ghText(["pr", "diff", String(pr), "--repo", repo]);
      removedControlLeads = findRemovedControlLines(diff);
      removedControlsScan = "diff";
    } catch {
      removedControlsScan = "manual_required";
    }
    pushSurface(requiredSurfaces, matched, "removed_controls", {
      why: removedControlLeads.length
        ? "diff removes auth/validation-like lines — prove controls still exist"
        : "baseline: check deletions for removed auth/validation (n/a if none)",
      files: [],
      leads: removedControlLeads.slice(0, 15),
      baseline: removedControlLeads.length === 0,
    });
  }

  const result = {
    repo,
    pr,
    url: meta.url,
    base: meta.baseRefName,
    headRefOid: meta.headRefOid,
    fileCount: files.length,
    filesSample: files.slice(0, 40),
    requiredSurfaces: [...new Set(requiredSurfaces)],
    matched,
    processSteps,
    requireAiAgentSecurity,
    requireAgenticSkillsTop10,
    requireDepsAudit,
    lockfilesChanged,
    manifestsChanged,
    packageManager,
    removedControlsScan,
    removedControlLeads: removedControlLeads.slice(0, 15),
    adversarialPassDefault: false,
    instructions: [
      "Cover every requiredSurfaces row in the chat coverage matrix (done + evidence, or n/a + why).",
      "Confidence: only HIGH → Confirmed findings; MEDIUM → Needs verification; LOW → residual only (Do-Not-Flag).",
      "HARD RULE: never launch a second adversarial/red-team pass (garak/promptfoo/PyRIT/extra attack subagent) unless the user explicitly asked this session.",
      requireAiAgentSecurity
        ? "REQUIRED: load skill ai-agent-security and review prompt/tool/MCP/RAG paths (defensive — not a red-team suite)."
        : "ai-agent-security optional (no AI/MCP-like paths detected).",
      requireAgenticSkillsTop10
        ? "REQUIRED: Agentic Skills Top 10 — read references/agentic-skills-top10.md; cover AST01–AST10 for skill/MCP install paths."
        : "Agentic Skills Top 10 optional (no SKILL.md / skills/ / MCP install config in diff).",
      requireDepsAudit
        ? `REQUIRED: run a deps audit lead (${packageManager || "detect PM"}) — treat as leads, not CVE fanfic.`
        : "Deps audit optional (no lockfile/manifest change).",
      requiredSurfaces.includes("iac_docker")
        ? "REQUIRED: review Dockerfile/compose/K8s/Terraform changes (secrets, privilege, ports, IAM)."
        : "IaC/Docker optional (no infra paths detected).",
      requiredSurfaces.includes("crypto_session")
        ? "REQUIRED: review crypto/JWT/cookie/TLS handling in touched files."
        : "Crypto/session optional (no crypto/cookie paths detected).",
      requiredSurfaces.includes("business_logic")
        ? "REQUIRED: review workflow/entitlement/step-skip/race paths."
        : "Business-logic optional (no workflow-like paths detected).",
      codeChanged
        ? removedControlLeads.length
          ? `REQUIRED: removed-controls — ${removedControlLeads.length} lead(s) from deleted lines; prove control remains or file finding.`
          : "REQUIRED: removed-controls pass on the diff (n/a if no control deletions)."
        : "Removed-controls optional (no code file changes).",
      "High/Critical Confirmed (HIGH confidence): fix in PR or get explicit user accept before Pass.",
      "Pass after fixes: include regression test or state why not.",
    ],
  };

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exit(0);
} catch (e) {
  console.error(String(e?.message || e));
  process.exit(2);
}
