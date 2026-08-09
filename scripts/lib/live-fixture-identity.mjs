import { Buffer } from "node:buffer";

const SENTINEL_PATH = ".github/github-delivery-live-fixture.json";
const SENTINEL_KIND = "github-delivery/live-fixture-target";

function requiredRepo(value, code) {
  const repo = String(value || "").trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error(`${code}_${repo ? "invalid" : "required"}`);
  }
  return repo;
}

function positiveId(value, code) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${code}_invalid`);
  return id;
}

function parseJson(value, code) {
  try {
    const parsed = JSON.parse(String(value || ""));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not_object");
    }
    return parsed;
  } catch {
    throw new Error(`${code}_invalid_json`);
  }
}

function runOrThrow(runner, args, code) {
  const result = runner("gh", args, {
    encoding: "utf8",
    maxBuffer: 5 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new Error(`${code}:${detail || `gh_failed_${result.status}`}`);
  }
  return String(result.stdout || "");
}

function repoMetadata(repo, runner) {
  return parseJson(
    runOrThrow(runner, ["api", `repos/${repo}`], "fixture_identity_repo_read_failed"),
    "fixture_identity_repo",
  );
}

function sentinelDocument(repo, baseBranch, runner) {
  const response = parseJson(
    runOrThrow(
      runner,
      [
        "api",
        `repos/${repo}/contents/${SENTINEL_PATH}?ref=${encodeURIComponent(baseBranch)}`,
      ],
      "fixture_identity_sentinel_read_failed",
    ),
    "fixture_identity_sentinel_response",
  );
  if (response.encoding !== "base64" || typeof response.content !== "string") {
    throw new Error("fixture_identity_sentinel_content_invalid");
  }
  return parseJson(
    Buffer.from(response.content.replace(/\s+/g, ""), "base64").toString("utf8"),
    "fixture_identity_sentinel",
  );
}

export function fixtureIdentitySentinelPath() {
  return SENTINEL_PATH;
}

export function assertFixtureTargetIdentity({
  sourceRepo,
  sourceRepoId,
  fixtureRepo,
  fixtureRepoId,
  expectedFixtureRepoId,
  sentinel,
} = {}) {
  sourceRepo = requiredRepo(sourceRepo, "source_repo");
  fixtureRepo = requiredRepo(fixtureRepo, "fixture_repo");
  sourceRepoId = positiveId(sourceRepoId, "source_repo_id");
  fixtureRepoId = positiveId(fixtureRepoId, "fixture_repo_id");
  expectedFixtureRepoId = positiveId(
    expectedFixtureRepoId,
    "expected_fixture_repo_id",
  );
  if (sourceRepo.toLowerCase() === fixtureRepo.toLowerCase()) {
    throw new Error("fixture_identity_same_repository_name");
  }
  if (sourceRepoId === fixtureRepoId) {
    throw new Error("fixture_identity_same_repository_id");
  }
  if (fixtureRepoId !== expectedFixtureRepoId) {
    throw new Error(
      `fixture_identity_id_mismatch: expected=${expectedFixtureRepoId} observed=${fixtureRepoId}`,
    );
  }
  if (!sentinel || typeof sentinel !== "object" || Array.isArray(sentinel)) {
    throw new Error("fixture_identity_sentinel_required");
  }
  if (sentinel.schemaVersion !== 1 || sentinel.kind !== SENTINEL_KIND) {
    throw new Error("fixture_identity_sentinel_schema_invalid");
  }
  if (String(sentinel.fixtureRepository || "").toLowerCase() !== fixtureRepo.toLowerCase()) {
    throw new Error("fixture_identity_sentinel_fixture_repo_mismatch");
  }
  if (positiveId(sentinel.fixtureRepositoryId, "sentinel_fixture_repo_id") !== fixtureRepoId) {
    throw new Error("fixture_identity_sentinel_fixture_id_mismatch");
  }
  if (String(sentinel.sourceRepository || "").toLowerCase() !== sourceRepo.toLowerCase()) {
    throw new Error("fixture_identity_sentinel_source_repo_mismatch");
  }
  if (positiveId(sentinel.sourceRepositoryId, "sentinel_source_repo_id") !== sourceRepoId) {
    throw new Error("fixture_identity_sentinel_source_id_mismatch");
  }
  return Object.freeze({
    sourceRepo,
    sourceRepoId,
    fixtureRepo,
    fixtureRepoId,
    expectedFixtureRepoId,
    sentinelPath: SENTINEL_PATH,
  });
}

export function verifyFixtureTargetIdentity({
  sourceRepo,
  fixtureRepo,
  expectedFixtureRepoId,
  baseBranch = "main",
  runner,
} = {}) {
  if (typeof runner !== "function") throw new Error("fixture_identity_runner_required");
  sourceRepo = requiredRepo(sourceRepo, "source_repo");
  fixtureRepo = requiredRepo(fixtureRepo, "fixture_repo");
  const source = repoMetadata(sourceRepo, runner);
  const fixture = repoMetadata(fixtureRepo, runner);
  const sentinel = sentinelDocument(fixtureRepo, String(baseBranch || "main"), runner);
  return assertFixtureTargetIdentity({
    sourceRepo,
    sourceRepoId: source.id,
    fixtureRepo,
    fixtureRepoId: fixture.id,
    expectedFixtureRepoId,
    sentinel,
  });
}
