const SHA_RE = /^[0-9a-f]{40}$/i;
const STATUSES = new Set(["reproduced", "not-reproduced", "blocked", "inconclusive"]);

function requireString(value, field) {
  if (!value || typeof value !== "string") throw new TypeError(`${field} must be a non-empty string`);
}

function requireEvidence(value, status) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${status} runtime attempt requires concrete evidence`);
  }
}

export function createRuntimeEvidenceSession({ target, repo, commitSha, environment } = {}) {
  requireString(target, "target");
  requireString(repo, "repo");
  if (!SHA_RE.test(String(commitSha || ""))) throw new TypeError("commitSha must be a 40-character Git SHA");
  if (!environment || typeof environment !== "object" || Array.isArray(environment)) {
    throw new TypeError("environment must be an object");
  }
  return {
    schemaVersion: 1,
    kind: "github-delivery/runtime-evidence",
    target,
    repo,
    commitSha,
    environment: structuredClone(environment),
    attempts: [],
  };
}

export function recordRuntimeAttempt(session, attempt = {}) {
  if (!session || session.kind !== "github-delivery/runtime-evidence") {
    throw new TypeError("invalid runtime evidence session");
  }
  requireString(attempt.id, "runtime attempt id");
  if (session.attempts.some((item) => item.id === attempt.id)) {
    throw new Error(`duplicate runtime attempt: ${attempt.id}`);
  }
  if (!STATUSES.has(attempt.status)) throw new TypeError(`unknown runtime attempt status: ${attempt.status}`);
  requireString(attempt.trigger, "runtime attempt trigger");
  requireEvidence(attempt.evidence, attempt.status);

  if (attempt.status === "reproduced" || attempt.status === "not-reproduced") {
    requireString(attempt.expected, "runtime attempt expected");
    requireString(attempt.actual, "runtime attempt actual");
  }
  if (attempt.status === "blocked" || attempt.status === "inconclusive") {
    requireString(attempt.blocker, "runtime attempt blocker");
  }

  const record = {
    id: attempt.id,
    status: attempt.status,
    trigger: attempt.trigger,
    ...(attempt.expected ? { expected: attempt.expected } : {}),
    ...(attempt.actual ? { actual: attempt.actual } : {}),
    ...(attempt.blocker ? { blocker: attempt.blocker } : {}),
    evidence: structuredClone(attempt.evidence),
    ...(attempt.command ? { command: String(attempt.command) } : {}),
    ...(attempt.notes ? { notes: String(attempt.notes) } : {}),
  };
  session.attempts.push(record);
  return structuredClone(record);
}

export function summarizeRuntimeEvidence(session) {
  if (!session || session.kind !== "github-delivery/runtime-evidence") {
    throw new TypeError("invalid runtime evidence session");
  }
  const reproducedAttempts = session.attempts.filter((item) => item.status === "reproduced").length;
  const notReproducedAttempts = session.attempts.filter((item) => item.status === "not-reproduced").length;
  const partialAttempts = session.attempts.filter((item) => item.status === "blocked" || item.status === "inconclusive").length;
  const blockers = [...new Set(session.attempts.map((item) => item.blocker).filter(Boolean))];

  let verdict = "no-attempts";
  if (reproducedAttempts > 0) verdict = "reproduced";
  else if (partialAttempts > 0) verdict = notReproducedAttempts > 0 ? "partial" : "blocked";
  else if (notReproducedAttempts > 0) verdict = "not-reproduced";

  return {
    schemaVersion: 1,
    kind: "github-delivery/runtime-evidence-summary",
    target: session.target,
    repo: session.repo,
    commitSha: session.commitSha,
    verdict,
    fixed: false,
    attemptCount: session.attempts.length,
    reproducedAttempts,
    notReproducedAttempts,
    partialAttempts,
    blockers,
    instructions: [
      "A not-reproduced result is evidence about this environment/attempt, not proof that the issue is fixed.",
      "A fixed claim requires separate change evidence plus a regression/reproduction check on the fixed head.",
      "Preserve exact expected/actual observations and artifact references; do not replace runtime evidence with narrative confidence.",
    ],
  };
}
