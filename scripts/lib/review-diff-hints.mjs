import { isReviewLogicPath } from "./review-scope.mjs";

const MECHANICAL_RE =
  /(^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|go\.sum|Gemfile\.lock|composer\.lock)$|(?:^|\/)(?:dist|build|coverage|generated)(?:\/|$)|\.(?:map|snap|min\.js)$/i;
const INDENT_SENSITIVE_RE = /\.(?:py|yaml|yml)$/i;

const MOVE_THRESHOLD = 3;
export const MOVE_DETECT_MAX_LINE_PRODUCT = 10_000;
export const MOVE_DETECT_MAX_CANDIDATE_PAIRS = 2_000;

export function classifyReviewFileRole(path) {
  const normalized = String(path || "").replaceAll("\\", "/");
  if (MECHANICAL_RE.test(normalized)) return "mechanical";
  if (isReviewLogicPath(normalized)) return "core";
  return "other";
}

function lineKey(value, preserveIndent) {
  const text = String(value || "").replace(/[ \t]+$/g, "");
  if (preserveIndent) return text;
  return text.replace(/[ \t]+/g, " ").trim();
}

function parseDiffChanges(patch) {
  const dels = [];
  const adds = [];
  let previousDel = false;
  let previousAdd = false;
  for (const line of String(patch || "").split(/\r?\n/)) {
    if (
      line.startsWith("diff ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("@@")
    ) {
      previousDel = false;
      previousAdd = false;
      continue;
    }
    if (line.startsWith("-")) {
      dels.push({ code: line.slice(1), consecutive: previousDel });
      previousDel = true;
      previousAdd = false;
      continue;
    }
    if (line.startsWith("+")) {
      adds.push({ code: line.slice(1), consecutive: previousAdd });
      previousAdd = true;
      previousDel = false;
      continue;
    }
    previousDel = false;
    previousAdd = false;
  }
  return { dels, adds };
}

function detectMoves(dels, adds, preserveIndent, stats) {
  const movedDels = {};
  const movedAdds = {};
  let changedLineCount = 0;
  let candidatePairs = stats?.candidatePairs ?? 0;
  for (let delIndex = 0; delIndex < dels.length; delIndex += 1) {
    if (movedDels[delIndex]) continue;
    const delBlock = [delIndex];
    for (
      let next = delIndex + 1;
      next < dels.length && next - delIndex < 40;
      next += 1
    ) {
      if (dels[next].consecutive && !movedDels[next]) delBlock.push(next);
      else break;
    }
    if (delBlock.length < MOVE_THRESHOLD) continue;
    const delNorm = delBlock.map((index) => lineKey(dels[index].code, preserveIndent));
    for (let addIndex = 0; addIndex < adds.length; addIndex += 1) {
      if (movedAdds[addIndex]) continue;
      const addBlock = [addIndex];
      for (
        let next = addIndex + 1;
        next < adds.length && next - addIndex < 40;
        next += 1
      ) {
        if (adds[next].consecutive && !movedAdds[next]) addBlock.push(next);
        else break;
      }
      if (addBlock.length < MOVE_THRESHOLD) continue;
      if (candidatePairs >= MOVE_DETECT_MAX_CANDIDATE_PAIRS) {
        if (stats) {
          stats.candidatePairs = candidatePairs;
          stats.skippedByBudget = true;
        }
        return { movedDels: {}, changedLineCount: 0, budgetExceeded: true };
      }
      candidatePairs += 1;
      if (stats) stats.candidatePairs = candidatePairs;
      const addNorm = addBlock.map((index) =>
        lineKey(adds[index].code, preserveIndent),
      );
      const overlap = Math.min(delNorm.length, addNorm.length);
      let matches = 0;
      for (let offset = 0; offset < overlap; offset += 1) {
        if (delNorm[offset] === addNorm[offset]) matches += 1;
      }
      if (matches >= MOVE_THRESHOLD && matches >= overlap * 0.7) {
        for (let offset = 0; offset < overlap; offset += 1) {
          if (delNorm[offset] === addNorm[offset]) {
            const exact = dels[delBlock[offset]].code === adds[addBlock[offset]].code;
            movedDels[delBlock[offset]] = { exact };
            movedAdds[addBlock[offset]] = { exact };
            if (!exact) changedLineCount += 1;
          } else {
            changedLineCount += 1;
          }
        }
        break;
      }
    }
  }
  return { movedDels, changedLineCount, budgetExceeded: false };
}

export function summarizeMovedCode(patch, path = "", options = {}) {
  const stats = options.stats;
  const preserveIndent = INDENT_SENSITIVE_RE.test(String(path || "").replaceAll("\\", "/"));
  const { dels, adds } = parseDiffChanges(patch);
  const lineProduct = dels.length * adds.length;
  if (stats) {
    stats.deleteCount = dels.length;
    stats.addCount = adds.length;
    stats.lineProduct = lineProduct;
    stats.candidatePairs = 0;
    stats.skippedByBudget = false;
  }
  if (lineProduct > MOVE_DETECT_MAX_LINE_PRODUCT) {
    if (stats) stats.skippedByBudget = true;
    return null;
  }
  const { movedDels, changedLineCount, budgetExceeded } = detectMoves(
    dels,
    adds,
    preserveIndent,
    stats,
  );
  if (budgetExceeded) return null;
  const movedLineCount = Object.keys(movedDels).length;
  if (movedLineCount < MOVE_THRESHOLD) return null;
  return {
    movedLineCount,
    changedLineCount,
    exact: changedLineCount === 0,
  };
}

export function reviewFileHintLabel(role) {
  switch (role) {
    case "mechanical":
      return "mechanical";
    case "core":
      return "core";
    case "other":
      return "other";
    default: {
      const exhaustive = role;
      throw new Error(`unknown_review_file_role:${exhaustive}`);
    }
  }
}
