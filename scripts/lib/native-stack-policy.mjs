export function normalizeNativeStack(stack) {
  if (stack == null) {
    return {
      present: false,
      complete: true,
      baseRefName: null,
      size: null,
    };
  }
  if (typeof stack !== "object") {
    return {
      present: true,
      complete: false,
      baseRefName: null,
      size: null,
    };
  }
  const baseRefName = String(stack.baseRefName || stack.base?.ref || "").trim() || null;
  const size = Number(stack.size);
  const sizeOk = Number.isInteger(size) && size >= 1;
  return {
    present: true,
    complete: Boolean(baseRefName) && sizeOk,
    baseRefName,
    size: sizeOk ? size : null,
  };
}

export function nativeStackFromSnapshot(snapshot = {}) {
  return normalizeNativeStack(snapshot?.evidence?.pullRequest?.stack);
}

export function protectionRefName(snapshot = {}) {
  const identity = nativeStackFromSnapshot(snapshot);
  if (identity.present && identity.baseRefName) return identity.baseRefName;
  return String(snapshot?.evidence?.pullRequest?.baseRefName || "");
}

export function nativeStackUnknowns(snapshot = {}, requiredChecks = {}) {
  const identity = nativeStackFromSnapshot(snapshot);
  if (!identity.present) return [];
  if (!identity.complete) return ["policy:native_stack_unreadable"];
  const unknowns = [];
  if (identity.size > 1) {
    unknowns.push("policy:native_stack_remaining_layers_unevaluated");
  }
  if (requiredChecks?.mode === "observed") {
    unknowns.push("policy:native_stack_observed_checks");
  }
  return unknowns;
}

export function nativeStackBlocksDirectMerge(snapshot = {}) {
  return nativeStackFromSnapshot(snapshot).present === true;
}
