import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  parseRepositorySpecifier,
  readRepositoryFile,
  resolveRepositorySnapshot,
} from "../../scripts/repository-context.mjs";

test("accepts owner/repo and nested github.com URLs", () => {
  assert.equal(parseRepositorySpecifier("acme/widgets"), "acme/widgets");
  assert.equal(
    parseRepositorySpecifier("https://github.com/acme/widgets/blob/dev/README.md"),
    "acme/widgets",
  );
});

test("rejects non-GitHub hosts instead of treating arbitrary URLs as repositories", () => {
  assert.throws(
    () => parseRepositorySpecifier("https://example.com/acme/widgets"),
    /repository_specifier_unsupported_host/,
  );
});

test("resolves the repository default branch and captures its exact commit SHA", () => {
  const calls = [];
  const snapshot = resolveRepositorySnapshot("acme/widgets", (command, args) => {
    calls.push([command, ...args]);
    if (args[0] === "repo") {
      return JSON.stringify({
        nameWithOwner: "Acme/Widgets",
        defaultBranchRef: { name: "develop" },
        url: "https://github.com/Acme/Widgets",
      });
    }
    return JSON.stringify({ sha: "0123456789abcdef0123456789abcdef01234567" });
  });

  assert.deepEqual(snapshot, {
    repo: "Acme/Widgets",
    defaultBranch: "develop",
    branch: "develop",
    sha: "0123456789abcdef0123456789abcdef01234567",
    url: "https://github.com/Acme/Widgets",
  });
  assert.deepEqual(calls, [
    ["gh", "repo", "view", "acme/widgets", "--json", "nameWithOwner,defaultBranchRef,url"],
    ["gh", "api", "repos/Acme/Widgets/commits/develop"],
  ]);
});

test("can pin a workflow-selected branch without confusing it with the default branch", () => {
  const calls = [];
  const snapshot = resolveRepositorySnapshot(
    "acme/widgets",
    (command, args) => {
      calls.push([command, ...args]);
      if (args[0] === "repo") {
        return JSON.stringify({
          nameWithOwner: "acme/widgets",
          defaultBranchRef: { name: "main" },
          url: "https://github.com/acme/widgets",
        });
      }
      return JSON.stringify({ sha: "abcdefabcdefabcdefabcdefabcdefabcdefabcd" });
    },
    "dev",
  );

  assert.equal(snapshot.defaultBranch, "main");
  assert.equal(snapshot.branch, "dev");
  assert.deepEqual(calls[1], ["gh", "api", "repos/acme/widgets/commits/dev"]);
});

test("fails closed when repository metadata or the resolved SHA is incomplete", () => {
  assert.throws(
    () =>
      resolveRepositorySnapshot("acme/widgets", (_command, args) =>
        args[0] === "repo"
          ? JSON.stringify({ nameWithOwner: "acme/widgets", defaultBranchRef: null })
          : JSON.stringify({ sha: "abc" }),
      ),
    /repository_default_branch_missing/,
  );

  assert.throws(
    () =>
      resolveRepositorySnapshot("acme/widgets", (_command, args) =>
        args[0] === "repo"
          ? JSON.stringify({
              nameWithOwner: "acme/widgets",
              defaultBranchRef: { name: "dev" },
              url: "https://github.com/acme/widgets",
            })
          : JSON.stringify({}),
      ),
    /repository_snapshot_sha_missing/,
  );
});

test("reads repository files against the captured SHA, never a moving branch alias", () => {
  let call = null;
  const content = readRepositoryFile(
    { repo: "acme/widgets", sha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" },
    "docs/guide.md",
    (command, args) => {
      call = [command, ...args];
      return "guide";
    },
  );

  assert.equal(content, "guide");
  assert.deepEqual(call, [
    "gh",
    "api",
    "repos/acme/widgets/contents/docs/guide.md?ref=deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    "-H",
    "Accept: application/vnd.github.raw+json",
  ]);
});

test("repository context guidance keeps lightweight reads SHA-bound and bounded", () => {
  const referenceUrl = new URL(
    "../../references/repository-context.md",
    import.meta.url,
  );
  assert.ok(existsSync(referenceUrl), "expected repository context companion");
  const reference = readFileSync(referenceUrl, "utf8");

  assert.match(reference, /resolve the repository's actual default branch/i);
  assert.match(reference, /capture its exact commit SHA/i);
  assert.match(reference, /exact SHA/i);
  assert.match(reference, /Do not guess `main`, `master`, or `HEAD`/i);
  assert.match(reference, /history.*runtime.*exhaustive.*modification/is);
  assert.match(reference, /does not prove an exhaustive codebase review/i);
  assert.match(reference, /optional adapter/i);
});

test("evidence policy conditionally composes the repository context companion", () => {
  const evidence = readFileSync(
    new URL("../../references/policy/evidence.md", import.meta.url),
    "utf8",
  );
  assert.match(evidence, /GD-EVID-007/);
  assert.match(evidence, /references\/repository-context\.md/);
  assert.match(evidence, /workflow-selected branch/i);
  assert.match(evidence, /Do not guess `main`, `master`, or `HEAD`/i);
  assert.match(
    evidence,
    /cannot by themselves prove history, runtime behavior, exhaustive repository coverage, or a modification result/i,
  );
});
