export function portablePathKey(path) {
  return String(path).normalize("NFC").toLowerCase();
}

const UNSAFE_SEGMENT = /[<>:"|?*\u0000-\u001f]/;
const RESERVED_SEGMENT = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

export function assertPortablePathIdentity(paths, { code = "release_path" } = {}) {
  const seen = new Map();
  for (const path of paths) {
    if (typeof path !== "string" || path.length === 0) {
      throw new Error(`${code}_invalid:${String(path)}`);
    }
    if (path !== path.normalize("NFC")) {
      throw new Error(`${code}_not_nfc:${path}`);
    }
    for (const segment of path.split("/")) {
      if (!segment || UNSAFE_SEGMENT.test(segment) || /[. ]$/.test(segment) || RESERVED_SEGMENT.test(segment)) {
        throw new Error(`${code}_unsafe:${path}`);
      }
    }
    const key = portablePathKey(path);
    const previous = seen.get(key);
    if (previous !== undefined && previous !== path) {
      throw new Error(`${code}_alias:${previous}~${path}`);
    }
    seen.set(key, path);
  }
  return true;
}
