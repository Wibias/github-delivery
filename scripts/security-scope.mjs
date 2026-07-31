#!/usr/bin/env node
/**
 * Map PR changed files → required security coverage surfaces.
 * Usage: node scripts/security-scope.mjs OWNER/REPO PR_NUMBER
 * Requires: gh auth
 *
 * Exit 0 always on success (JSON to stdout). Exit 2 on usage/gh error.
 * Agents MUST cover every surface in requiredSurfaces (or justified n/a).
 * If requireAiAgentSecurity: load skill ai-agent-security.
 * If lockfilesChanged: run package-manager audit as a lead.
 */
import { spawnSync } from "node:child_process";

const [repo, prRaw] = process.argv.slice(2);
if (!repo || !prRaw || !repo.includes("/")) {
  console.error("Usage: node scripts/security-scope.mjs OWNER/REPO PR_NUMBER");
  process.exit(2);
}

const pr = Number(prRaw);
const [owner, name] = repo.split("/");

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
      if (/catalog/i.test(f)) return /telemetry|analytics|sentry|privacy|[/_.-]pii([/_.-]|$)/i.test(f);
      return (
        /(^|\/)([^/]*log(ger|ging|s)?|telemetry|analytics|sentry)(\/|\.|$)/i.test(f) ||
        /privacy|[/_.-]pii([/_.-]|$)/i.test(f)
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
  credential_destinations: {
    why: "provider presets / baseUrl / OAuth / API key routing",
    test: (f) =>
      /providers\/|baseUrl|oauth|apiKey|preset|catalog|derive\.ts|registry\.ts/i.test(
        f,
      ),
  },
};

const LOCKFILE_RE =
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|go\.sum)$/i;
const MANIFEST_RE = /(^|\/)(package\.json|Cargo\.toml|go\.mod)$/i;

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

  // Always require variant_analysis as a process step (not file-derived)
  const processSteps = ["variant_analysis_if_findings"];

  const lockfilesChanged = files.filter((f) => LOCKFILE_RE.test(f));
  const manifestsChanged = files.filter((f) => MANIFEST_RE.test(f));
  const requireDepsAudit = lockfilesChanged.length > 0 || manifestsChanged.length > 0;

  let packageManager = null;
  if (requireDepsAudit) {
    const joined = files.join("\n");
    if (/bun\.lockb?|package\.json/i.test(joined)) packageManager = "bun|npm|pnpm (detect from repo)";
    if (/pnpm-lock\.yaml/i.test(joined)) packageManager = "pnpm";
    else if (/yarn\.lock/i.test(joined)) packageManager = "yarn";
    else if (/package-lock\.json/i.test(joined)) packageManager = "npm";
    else if (/bun\.lockb?/i.test(joined)) packageManager = "bun";
    else if (/Cargo\.(toml|lock)/i.test(joined)) packageManager = "cargo";
    else if (/go\.(mod|sum)/i.test(joined)) packageManager = "go";
  }

  const requireAiAgentSecurity = requiredSurfaces.includes("ai_agent_mcp");

  const alwaysBaseline = ["authn", "authz", "secrets_config", "injection"];
  // Baseline applies lightly: if any code (.ts/.js/.go/.py/…) changed, keep baseline
  const codeChanged = files.some((f) =>
    /\.(ts|tsx|js|jsx|mjs|cjs|go|py|rs|java|kt|rb|php)$/i.test(f),
  );
  for (const b of alwaysBaseline) {
    if (codeChanged && !requiredSurfaces.includes(b)) {
      requiredSurfaces.push(b);
      matched[b] = {
        why: "baseline for code diffs (may be n/a with justification if surface untouched)",
        files: [],
        baseline: true,
      };
    }
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
    requireDepsAudit,
    lockfilesChanged,
    manifestsChanged,
    packageManager,
    instructions: [
      "Cover every requiredSurfaces row in the chat coverage matrix (done + evidence, or n/a + why).",
      requireAiAgentSecurity
        ? "REQUIRED: load skill ai-agent-security and review prompt/tool/MCP/RAG paths."
        : "ai-agent-security optional (no AI/MCP-like paths detected).",
      requireDepsAudit
        ? `REQUIRED: run a deps audit lead (${packageManager || "detect PM"}) — treat as leads, not CVE fanfic.`
        : "Deps audit optional (no lockfile/manifest change).",
      "High/Critical findings: fix in PR or get explicit user accept before Pass.",
      "Pass after fixes: include regression test or state why not.",
    ],
  };

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exit(0);
} catch (e) {
  console.error(String(e?.message || e));
  process.exit(2);
}
