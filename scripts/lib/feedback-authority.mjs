const PERMISSION_REQUIRED_ASSOCIATIONS = new Set(["MEMBER", "COLLABORATOR"]);
const WRITE_LEVEL_PERMISSIONS = new Set(["ADMIN", "MAINTAIN", "WRITE"]);
const BOT_RE = /\[bot\]$/i;

function loginOf(raw) {
  return raw?.user?.login || raw?.author?.login || raw?.login || null;
}

function associationOf(raw) {
  return raw?.author_association || raw?.authorAssociation || raw?.association || null;
}

export function repositoryPermissionCanMaintainFeedback(permission) {
  return WRITE_LEVEL_PERMISSIONS.has(String(permission || "").toUpperCase());
}

export function feedbackRequiresRepositoryPermission(raw) {
  const login = loginOf(raw);
  if (!login || BOT_RE.test(login) || login === "github-actions") return false;
  return PERMISSION_REQUIRED_ASSOCIATIONS.has(String(associationOf(raw) || "").toUpperCase());
}

export function feedbackPermissionLogins(collections = []) {
  const logins = new Set();
  for (const collection of collections) {
    for (const row of collection?.rows || []) {
      if (!feedbackRequiresRepositoryPermission(row)) continue;
      const login = loginOf(row);
      if (login) logins.add(login);
    }
  }
  return [...logins].sort((a, b) => a.localeCompare(b));
}

export function attachRepositoryPermissions(collection, permissionsByLogin = {}) {
  if (!collection) return collection;
  return {
    ...collection,
    rows: (collection.rows || []).map((row) => {
      if (!feedbackRequiresRepositoryPermission(row)) return row;
      const login = loginOf(row);
      return {
        ...row,
        repository_permission: permissionsByLogin[login] || null,
      };
    }),
  };
}
