#!/usr/bin/env node
/**
 * Map PR changed files → bug-review depth (skip vs deep + complementary lenses).
 * Usage: node scripts/bug-scope.mjs OWNER/REPO PR_NUMBER
 *        node scripts/bug-scope.mjs --self-test
 * Requires: gh auth (except --self-test)
 *
 * Exit 0 on success (JSON to stdout). Exit 2 on usage/gh error.
 * If skipDeepBugReview: record n/a — no Bugbot / complementary required.
 * Else: require complementary lenses; Bugbot when_available (Cursor only).
 * Never auto-launch deep multi-agent toolkits (user must ask).
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

/** Non-logic / chore paths — deep bug review may skip when ALL files match. */
function isNonLogicPath(f) {
  if (
    /\.(md|txt|rst|adoc|css|scss|sass|less|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|eot)$/i.test(
      f,
    )
  ) {
    return true;
  }
  if (
    /(^|\/)(LICENSE|CHANGELOG|NOTICE|THIRD_PARTY|CODEOWNERS|\.gitattributes|\.gitignore|\.editorconfig)(\.|$)/i.test(
      f,
    )
  ) {
    return true;
  }
  if (
    /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|go\.sum|Gemfile\.lock|composer\.lock)$/i.test(
      f,
    )
  ) {
    return true;
  }
  if (/(^|\/)docs?\//i.test(f) && !/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs)$/i.test(f)) {
    return true;
  }
  return false;
}

/** Logic-bearing code (triggers deep bug review). */
function isLogicCodePath(f) {
  if (isNonLogicPath(f)) return false;
  return /\.(ts|tsx|js|jsx|mjs|cjs|go|py|rs|java|kt|rb|php|cs|swift|c|cc|cpp|h|hpp|vue|svelte)$/i.test(
    f,
  );
}

const COMPLEMENTARY_LENSES = [
  "silent_failures",
  "resource_leaks",
  "edge_cases",
];

if (argv[0] === "--self-test") {
  const cases = [
    ["README.md", true, false],
    ["styles/app.css", true, false],
    ["pnpm-lock.yaml", true, false],
    ["src/auth/login.ts", false, true],
    ["server/api/handler.go", false, true],
    ["docs/guide.md", true, false],
  ];
  for (const [f, nonLogic, logic] of cases) {
    if (isNonLogicPath(f) !== nonLogic || isLogicCodePath(f) !== logic) {
      console.error("self-test failed for", f, {
        nonLogic: isNonLogicPath(f),
        logic: isLogicCodePath(f),
        expected: { nonLogic, logic },
      });
      process.exit(1);
    }
  }
  console.log(
    JSON.stringify(
      { ok: true, lenses: COMPLEMENTARY_LENSES, sample: "src/x.ts deep" },
      null,
      2,
    ),
  );
  process.exit(0);
}

const [repo, prRaw] = argv;
if (!repo || !prRaw || !repo.includes("/")) {
  console.error("Usage: node scripts/bug-scope.mjs OWNER/REPO PR_NUMBER");
  console.error("       node scripts/bug-scope.mjs --self-test");
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

  const logicFiles = files.filter((f) => isLogicCodePath(f));
  const codeChanged = logicFiles.length > 0;
  const skipDeepBugReview =
    files.length === 0 || (!codeChanged && files.every((f) => isNonLogicPath(f)));

  const requiredLenses = skipDeepBugReview ? [] : [...COMPLEMENTARY_LENSES];

  const result = {
    repo,
    pr,
    url: meta.url,
    base: meta.baseRefName,
    headRefOid: meta.headRefOid,
    fileCount: files.length,
    filesSample: files.slice(0, 40),
    logicFileCount: logicFiles.length,
    logicFilesSample: logicFiles.slice(0, 20),
    codeChanged,
    skipDeepBugReview,
    requiredLenses,
    requireBugbot: "when_available",
    deepMultiAgentDefault: false,
    instructions: [
      "Follow references/bug-review.md.",
      skipDeepBugReview
        ? "skipDeepBugReview: true — record n/a (non-logic / docs / lockfile / assets only). No Bugbot or complementary required."
        : "Deep bug review REQUIRED: complementary lenses (silent_failures, resource_leaks, edge_cases) in ONE structured pass.",
      "requireBugbot=when_available: on Cursor launch review-bugbot / bugbot once; on Claude/Codex never claim Bugbot — use lenses (+ Codex /review if available).",
      "Confidence: only HIGH → Confirmed findings; MEDIUM → Needs verification; LOW → residual (Do-Not-Flag style/nits).",
      "HARD RULE: never auto-launch deep multi-agent toolkits (pr-review-toolkit, ultrareview, Codex adversarial-review) unless the user explicitly asked this session.",
      "On Cursor, complementary is additive to Bugbot (do not skip complementary after a clean Bugbot).",
    ],
  };

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exit(0);
} catch (e) {
  console.error(String(e?.message || e));
  process.exit(2);
}
