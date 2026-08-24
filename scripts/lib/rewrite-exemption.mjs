export const REWRITE_EXEMPTIONS = new Set(["restack", "conflicts", "simplify-pr"]);

export function parseRewriteExemption(value, invalidCode) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !REWRITE_EXEMPTIONS.has(value)) {
    throw new Error(invalidCode);
  }
  return value;
}
