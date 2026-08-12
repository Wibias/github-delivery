export function parseNpmPackJson(stdout) {
  const text = String(stdout || "").trim();
  if (!text) throw new Error("npm_pack_json_missing");

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`npm_pack_json_invalid:${error?.message || String(error)}`);
  }

  if (Array.isArray(parsed)) return parsed;

  if (parsed && typeof parsed === "object") {
    if (Array.isArray(parsed.files)) return [parsed];

    const packs = Object.values(parsed).filter(
      (value) => value && typeof value === "object" && Array.isArray(value.files),
    );
    if (packs.length > 0) return packs;
  }

  throw new Error("npm_pack_json_shape_invalid");
}
