function sameRepo(left, right) {
  return String(left || "").toLowerCase() === String(right || "").toLowerCase();
}

function repoName(row, side) {
  return row?.[`${side}RepoFullName`] ?? row?.[side]?.repo?.full_name ?? row?.[side]?.repo?.nameWithOwner ?? null;
}

export function normalizeCoveringPullPages(payload, targetRepo) {
  if (!Array.isArray(payload)) throw new Error("covering_pr_pages_invalid");
  const pages = payload.length && payload.every(Array.isArray) ? payload : [payload];
  const rows = [];
  for (const page of pages) {
    if (!Array.isArray(page)) throw new Error("covering_pr_page_invalid");
    for (const raw of page) {
      const number = Number(raw?.number);
      const url = raw?.url ?? raw?.html_url;
      const headRefName = raw?.headRefName ?? raw?.head?.ref;
      const baseRefName = raw?.baseRefName ?? raw?.base?.ref;
      const headRepoFullName = repoName(raw, "head");
      const targetRepoFullName = raw?.targetRepoFullName ?? repoName(raw, "base") ?? targetRepo;
      if (
        !Number.isInteger(number) || number <= 0 || !url || !headRefName || !baseRefName ||
        !headRepoFullName || !targetRepoFullName
      ) {
        throw new Error("covering_pr_row_incomplete");
      }
      rows.push({
        number,
        url: String(url),
        state: String(raw?.state || "open").toLowerCase(),
        headRefName: String(headRefName),
        baseRefName: String(baseRefName),
        headRepoFullName: String(headRepoFullName),
        targetRepoFullName: String(targetRepoFullName),
      });
    }
  }
  return rows;
}

export function classifyCoveringPullRequests({
  intendedRepo,
  intendedHeadRepo = null,
  intendedHead,
  intendedBase,
  rows = [],
} = {}) {
  const matches = rows
    .filter((row) => row?.state !== "closed")
    .filter((row) => sameRepo(row?.targetRepoFullName, intendedRepo))
    .filter((row) => !intendedHeadRepo || sameRepo(row?.headRepoFullName, intendedHeadRepo))
    .filter((row) => String(row?.headRefName || "") === String(intendedHead || ""))
    .filter((row) => String(row?.baseRefName || "") === String(intendedBase || ""))
    .sort((a, b) => a.number - b.number);

  if (matches.length === 0) return { state: "none", matches: [] };
  if (matches.length === 1) return { state: "reuse", pullRequest: matches[0], matches };
  return { state: "ambiguous", matches };
}
