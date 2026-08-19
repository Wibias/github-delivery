#!/usr/bin/env node
/**
 * One-call PR review brief: digest the scope plan + diff into a compact brief
 * so the review agent starts from facts instead of re-reading sources.
 *
 * Usage:
 *   node scripts/review-brief.mjs OWNER/REPO PR_NUMBER [--max-hunk-lines N] [--max-total-hunk-lines N] [--json]
 *
 * Default output is a compact text brief (fast to read). --json emits the full
 * structured plan for tooling.
 */
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { collectPrReviewInput, planReviewScope } from "./lib/review-scope.mjs";
import { projectBugScope, projectSecurityScope } from "./lib/review-scope-compat.mjs";
import { planReviewDepthExecution } from "./lib/review-depth-execution.mjs";
import { extractRequiredProbeBlocks } from "./lib/probe-blocks.mjs";
import { ownedHelperEffect } from "./lib/watchdog-evidence-registry.mjs";

const DEFAULT_MAX_HUNK_LINES = 24;
const DEFAULT_MAX_TOTAL_HUNK_LINES = 1_200;
const USAGE =
  "Usage: node scripts/review-brief.mjs OWNER/REPO PR_NUMBER [--max-hunk-lines N] [--max-total-hunk-lines N] [--no-reference-map] [--json]";

function positiveInteger(value, option) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${option} requires a positive integer`);
  }
  return number;
}

function parseArgs(argv) {
  const positional = [];
  const options = {
    maxHunkLines: DEFAULT_MAX_HUNK_LINES,
    maxTotalHunkLines: DEFAULT_MAX_TOTAL_HUNK_LINES,
    referenceMap: true,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--max-hunk-lines") {
      options.maxHunkLines = positiveInteger(argv[++index], "--max-hunk-lines");
    } else if (value === "--max-total-hunk-lines") {
      options.maxTotalHunkLines = positiveInteger(
        argv[++index],
        "--max-total-hunk-lines",
      );
    } else if (value === "--no-reference-map") {
      options.referenceMap = false;
    } else if (value === "--json") {
      options.json = true;
    } else {
      positional.push(value);
    }
  }
  if (positional.length !== 2) throw new Error(USAGE);
  const repo = positional[0];
  const pr = Number(positional[1]);
  if (!repo?.includes("/") || !Number.isInteger(pr) || pr <= 0) throw new Error(USAGE);
  return { repo, pr, ...options };
}

export function hunkLines(patch = "", maxLines) {
  const lines = String(patch).split(/\r?\n/);
  const shown = lines.slice(0, maxLines);
  const truncated = lines.length > maxLines;
  return {
    text: shown.join("\n"),
    truncated,
    totalLines: lines.length,
    shownLines: shown.length,
  };
}

export function normalizeFile(file) {
  return {
    path: file?.path || file?.filename || "unknown",
    previousPath: file?.previousPath || file?.previous_filename || null,
    status: file?.status || "modified",
    patch: file?.patch || "",
    additions: Number(file?.additions || 0),
    deletions: Number(file?.deletions || 0),
  };
}

export function briefText({
  meta,
  plan,
  files,
  bugScope,
  securityScope,
  executionPlan = null,
  maxHunkLines = DEFAULT_MAX_HUNK_LINES,
  maxTotalHunkLines = DEFAULT_MAX_TOTAL_HUNK_LINES,
  probeBlocks = [],
}) {
  const out = [];
  out.push(`# Review brief: ${meta.repo}#${meta.pr}`);
  out.push(`Head: ${plan.headRefOid || "unknown"}`);
  out.push(`Files: ${plan.fileCount}  Logic: ${plan.logicFiles.length}`);
  out.push("");

  if (executionPlan) {
    out.push("## Review depth execution");
    out.push(`Bug depth: ${executionPlan.bug.depth}`);
    for (const stage of executionPlan.bug.stages) out.push(`- [bug] ${stage.id}: ${stage.description}`);
    out.push(`Security depth: ${executionPlan.security.depth}`);
    for (const stage of executionPlan.security.stages) out.push(`- [security] ${stage.id}: ${stage.description}`);
    out.push("");
  }

  out.push("## Required bug lenses");
  if (bugScope.requiredLenses.length) {
    out.push(bugScope.requiredLenses.map((id) => `- ${id}`).join("\n"));
  } else {
    out.push("- (none)");
  }
  out.push("");

  out.push("## Required security surfaces");
  if (securityScope.requiredSurfaces.length) {
    out.push(securityScope.requiredSurfaces.map((id) => `- ${id}`).join("\n"));
  } else {
    out.push("- (none)");
  }
  out.push("");

  if (plan.requiredProbes.length) {
    out.push("## Required probes");
    out.push(plan.requiredProbes.map((id) => `- ${id}`).join("\n"));
    out.push("");
  }

  if (plan.dependencyChanges.length) {
    out.push("## Dependency changes");
    for (const change of plan.dependencyChanges) {
      out.push(`- ${change.file} (${change.kind}, +${change.additions}/-${change.deletions})`);
    }
    out.push("");
  }

  if (plan.removedControlLeads.length) {
    out.push("## Removed control leads");
    for (const lead of plan.removedControlLeads.slice(0, 10)) {
      out.push(`- ${lead.file}: ${lead.line}`);
    }
    out.push("");
  }

  if (plan.uncertainty.length) {
    out.push("## Uncertainty");
    for (const item of plan.uncertainty) {
      out.push(`- ${item.code}: ${item.effect}`);
    }
    out.push("");
  }

  out.push("## Changed files (diff hunks)");
  let remainingHunkLines = maxTotalHunkLines;
  for (const raw of files) {
    const file = normalizeFile(raw);
    out.push(`### ${file.path} (+${file.additions}/-${file.deletions})`);

    if (!file.patch.trim()) {
      out.push("_(no patch text available)_");
      out.push("");
      continue;
    }

    if (remainingHunkLines <= 0) {
      out.push(
        `_(diff hunk omitted: global hunk budget of ${maxTotalHunkLines} lines exhausted; open this file only if a lens needs more)_`,
      );
      out.push("");
      continue;
    }

    const perFileLimit = Math.min(maxHunkLines, remainingHunkLines);
    const { text, truncated, totalLines, shownLines } = hunkLines(file.patch, perFileLimit);
    remainingHunkLines -= shownLines;
    out.push("```diff");
    out.push(text);
    out.push("```");
    if (truncated) {
      const globalLimitReached = remainingHunkLines <= 0;
      out.push(
        globalLimitReached
          ? `_(${totalLines} hunk lines; ${shownLines} shown before the global hunk budget of ${maxTotalHunkLines} lines was exhausted; open this file on demand)_`
          : `_(${totalLines} hunk lines; ${shownLines} shown; open the file only if a lens needs more)_`,
      );
    }
    out.push("");
  }

  if (probeBlocks.length) {
    out.push("## Required probe blocks (from the reference docs)");
    for (const block of probeBlocks) {
      out.push(`### ${block.id} (${block.doc}:${block.startLine}-${block.endLine})`);
      out.push(block.text);
      out.push("");
    }
  }

  return out.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = collectPrReviewInput(args.repo, args.pr);
  const plan = planReviewScope(input);
  const bugScope = projectBugScope(plan);
  const securityScope = projectSecurityScope(plan);
  const executionPlan = planReviewDepthExecution({ bugScope, securityScope });
  const probeBlocks = args.referenceMap
    ? extractRequiredProbeBlocks([
        ...bugScope.requiredProbes.map((id) => ({ id, axis: "bug" })),
        ...securityScope.requiredProbes.map((id) => ({ id, axis: "security" })),
      ])
    : [];

  if (args.json) {
    const out = {
      schemaVersion: 1,
      kind: "github-delivery/review-brief",
      gdEffect: {
        ...ownedHelperEffect("review-brief.mjs"),
        key: `pr-review-brief:${args.repo}:${args.pr}`,
      },
      repo: args.repo,
      pr: args.pr,
      headRefOid: plan.headRefOid,
      bugScope,
      securityScope,
      executionPlan,
      probeBlocks,
      plan,
    };
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    `${briefText({
      meta: { repo: args.repo, pr: args.pr },
      plan,
      files: input.files,
      bugScope,
      securityScope,
      executionPlan,
      maxHunkLines: args.maxHunkLines,
      maxTotalHunkLines: args.maxTotalHunkLines,
      probeBlocks,
    })}\n`,
  );
}

if (process.argv[1]) {
  const invokedPath = realpathSync(process.argv[1]);
  if (import.meta.url === pathToFileURL(invokedPath).href) {
    main().catch((error) => {
      console.error(String(error?.message || error));
      process.exit(2);
    });
  }
}
