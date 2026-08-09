const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REMOTE_NAME = "github-delivery-fixture";

function requiredRepo(value, code) {
  const repo = String(value || "").trim();
  if (!repo) throw new Error(`${code}_required`);
  if (!REPO_RE.test(repo)) throw new Error(`${code}_invalid`);
  return repo;
}

export function fixtureRemoteName() {
  return REMOTE_NAME;
}

export function fixtureRemoteUrl(repo) {
  repo = requiredRepo(repo, "fixture_repo");
  return `https://github.com/${repo}.git`;
}

export function assertFixtureRepositoryIsolation({
  sourceRepo,
  fixtureRepo,
  allowSameRepository = false,
} = {}) {
  sourceRepo = requiredRepo(sourceRepo, "source_repo");
  fixtureRepo = requiredRepo(fixtureRepo, "fixture_repo");
  const sameRepository =
    sourceRepo.toLowerCase() === fixtureRepo.toLowerCase();
  if (sameRepository && allowSameRepository !== true) {
    throw new Error(
      `fixture_repo_must_be_separate: source=${sourceRepo} fixture=${fixtureRepo}`,
    );
  }
  return { sourceRepo, fixtureRepo, sameRepository };
}

export function allowSameRepositoryFixture(env = process.env) {
  return (
    env.GITHUB_ACTIONS !== "true" &&
    env.GITHUB_DELIVERY_ALLOW_SAME_REPO_FIXTURE === "1"
  );
}
