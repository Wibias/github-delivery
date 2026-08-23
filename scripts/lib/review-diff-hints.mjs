const MECHANICAL_RE =
  /(^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|go\.sum|Gemfile\.lock|composer\.lock)$|(?:^|\/)(?:dist|build|coverage|generated)\b|\.(?:map|snap|min\.js)$/i;
const CORE_RE =
  /\.(?:[cm]?[jt]sx?|mjs|cjs|py|go|rs|java|kt|rb|php|cs|swift|c|cc|cpp|h|hpp|vue|svelte)$/i;

const MOVE_THRESHOLD = 3;

export function classifyReviewFileRole(path) {
  const normalized = String(path || "").replaceAll("\\", "/");
  if (MECHANICAL_RE.test(normalized)) return "mechanical";
  if (CORE_RE.test(normalized)) return "core";
  return "other";
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
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

function detectMoves(dels, adds) {
  const movedDels = {};
  const movedAdds = {};
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
    const delNorm = delBlock.map((index) => normalizeWhitespace(dels[index].code));
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
      const addNorm = addBlock.map((index) =>
        normalizeWhitespace(adds[index].code),
      );
      const overlap = Math.min(delNorm.length, addNorm.length);
      let matches = 0;
      for (let offset = 0; offset < overlap; offset += 1) {
        if (delNorm[offset] === addNorm[offset]) matches += 1;
      }
      if (matches >= MOVE_THRESHOLD && matches >= overlap * 0.7) {
        for (let offset = 0; offset < overlap; offset += 1) {
          movedDels[delBlock[offset]] = { exact: delNorm[offset] === addNorm[offset] };
          movedAdds[addBlock[offset]] = { exact: delNorm[offset] === addNorm[offset] };
        }
        break;
      }
    }
  }
  return { movedDels, movedAdds };
}

export function summarizeMovedCode(patch) {
  const { dels, adds } = parseDiffChanges(patch);
  const { movedDels } = detectMoves(dels, adds);
  const moved = Object.values(movedDels);
  if (moved.length < MOVE_THRESHOLD) return null;
  return {
    movedLineCount: moved.length,
    exact: moved.every((item) => item.exact === true),
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
