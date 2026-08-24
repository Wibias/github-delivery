import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  authorityScopeForRequest,
  authorityScopeSha256,
} from "../../scripts/lib/authority-scope.mjs";
import { executeLifecycleMutationRequest } from "../../scripts/lib/github-lifecycle-mutation-broker.mjs";
import { createMemoryRewriteBaselineStore } from "../../scripts/lib/rewrite-baseline-store.mjs";
import {
  lifecycleCommandFor,
  preflightLifecycleMutation,
  validateLifecycleMutation,
  verifyLifecycleMutation,
} from "../../scripts/lib/lifecycle-mutations.mjs";

const OLD = "a".repeat(40);
const NEXT = "b".repeat(40);
const LOCAL = "e".repeat(40);
const OTHER = "f".repeat(40);
const TREE_A = "c".repeat(40);
const TREE_B = "d".repeat(40);

function pushRequest(overrides = {}) {
  return {
    schemaVersion: 1,
    action: "push_code",
    mutationMode: "maintainer",
    explicitInstruction: true,
    repo: "Wibias/github-delivery",
    remote: "origin",
    branch: "feature/safe",
    expectedRemoteTip: OLD,
    originalLocalTip: LOCAL,
    newTip: NEXT,
    forceWithLease: true,
    ...overrides,
  };
}

function identityOk() {
  return {
    url: "https://github.com/Wibias/github-delivery",
    sshUrl: "git@github.com:Wibias/github-delivery.git",
  };
}

function seededStore(sha = LOCAL) {
  const store = createMemoryRewriteBaselineStore();
  store.create(
    { repo: "Wibias/github-delivery", remote: "origin", branch: "feature/safe" },
    sha,
  );
  return store;
}

const MIDDLE = "9".repeat(40);

function rewriteRunner({
  ancestor = false,
  isAncestor,
  remoteTip = OLD,
  remoteTree = TREE_A,
  originalTree = TREE_A,
  newTree = TREE_A,
  headTip = LOCAL,
  remoteUrl = "git@github.com:Wibias/github-delivery.git",
  reflogEntries,
  reflogStatus = 0,
} = {}) {
  return (command, args) => {
    if (command === "git" && args[0] === "check-ref-format") return { status: 0, stdout: "", stderr: "" };
    if (command === "git" && args[0] === "remote") {
      return { status: 0, stdout: `${remoteUrl}\n`, stderr: "" };
    }
    if (command === "gh" && args[0] === "repo") {
      return { status: 0, stdout: JSON.stringify(identityOk()), stderr: "" };
    }
    if (command === "git" && args[0] === "ls-remote") {
      return { status: 0, stdout: `${remoteTip}\trefs/heads/feature/safe\n`, stderr: "" };
    }
    if (command === "git" && args[0] === "log") {
      if (reflogStatus !== 0) {
        return { status: reflogStatus, stdout: "", stderr: "fatal: no reflog" };
      }
      const entries = reflogEntries ?? [
        { sha: NEXT, tree: newTree },
        { sha: LOCAL, tree: originalTree },
      ];
      return {
        status: 0,
        stdout: `${entries.map((entry) => `${entry.sha} ${entry.tree}`).join("\n")}\n`,
        stderr: "",
      };
    }
    if (command === "git" && args[0] === "merge-base") {
      if (args[1] === "--is-ancestor" && typeof isAncestor === "function") {
        const ok = isAncestor(String(args[2] || ""), String(args[3] || ""));
        return { status: ok ? 0 : 1, stdout: "", stderr: "" };
      }
      return { status: ancestor ? 0 : 1, stdout: "", stderr: "" };
    }
    if (command === "git" && args[0] === "update-ref") {
      const ref = String(args[1] || "");
      const oldValue = String(args[3] || "");
      if (ref === "refs/heads/feature/safe" && oldValue && oldValue !== headTip) {
        return { status: 1, stdout: "", stderr: "fatal: cannot lock ref" };
      }
      return { status: 0, stdout: "", stderr: "" };
    }
    if (command === "git" && args[0] === "rev-parse") {
      const spec = args[1] === "--verify" ? String(args[2] || "") : String(args[1] || "");
      if (spec === "refs/heads/feature/safe") {
        return { status: 0, stdout: `${headTip}\n`, stderr: "" };
      }
      if (spec.startsWith(OLD)) return { status: 0, stdout: `${remoteTree}\n`, stderr: "" };
      if (spec.startsWith(LOCAL)) return { status: 0, stdout: `${originalTree}\n`, stderr: "" };
      if (spec.startsWith(NEXT)) return { status: 0, stdout: `${newTree}\n`, stderr: "" };
    }
    throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
  };
}

test("a same-request originalLocalTip equal to newTip cannot satisfy the rewrite guard", () => {
  assert.throws(
    () =>
      preflightLifecycleMutation({
        request: pushRequest({ originalLocalTip: NEXT }),
        runner: rewriteRunner({ ancestor: false, originalTree: TREE_A, newTree: TREE_A }),
        baselineStore: seededStore(NEXT),
      }),
    /original_local_tip_tautological/,
  );
});

test("history-only rewrite without a broker rewrite baseline cannot reach push_code", () => {
  assert.throws(
    () =>
      preflightLifecycleMutation({
        request: pushRequest(),
        runner: rewriteRunner({ ancestor: false, originalTree: TREE_A, newTree: TREE_A }),
        baselineStore: createMemoryRewriteBaselineStore(),
      }),
    /original_local_tip_baseline_required/,
  );
});

test("an unreadable rewrite baseline store is not treated as missing", () => {
  assert.throws(
    () =>
      preflightLifecycleMutation({
        request: pushRequest(),
        runner: rewriteRunner({ ancestor: false, originalTree: TREE_A, newTree: TREE_A }),
        baselineStore: {
          read() {
            throw new Error("rewrite_baseline_store_unreadable");
          },
        },
      }),
    /rewrite_baseline_store_unreadable/,
  );
});

test("a forged git rewrite-baseline ref cannot satisfy push_code", () => {
  assert.throws(
    () =>
      preflightLifecycleMutation({
        request: pushRequest(),
        runner: rewriteRunner({ ancestor: false, originalTree: TREE_A, newTree: TREE_A }),
        baselineStore: createMemoryRewriteBaselineStore(),
      }),
    /original_local_tip_baseline_required/,
  );
});

test("push_code originalLocalTip must match the broker-owned rewrite baseline", () => {
  assert.throws(
    () =>
      preflightLifecycleMutation({
        request: pushRequest({ originalLocalTip: NEXT }),
        runner: rewriteRunner({ ancestor: false, originalTree: TREE_A, newTree: TREE_A }),
        baselineStore: seededStore(LOCAL),
      }),
    /original_local_tip_baseline_mismatch/,
  );
});

function recordRequest(overrides = {}) {
  return {
    schemaVersion: 1,
    action: "record_rewrite_baseline",
    mutationMode: "maintainer",
    explicitInstruction: true,
    repo: "Wibias/github-delivery",
    remote: "origin",
    branch: "feature/safe",
    originalLocalTip: LOCAL,
    ...overrides,
  };
}

test("record_rewrite_baseline writes the captured SHA, not a live branch ref", () => {
  const request = recordRequest();
  assert.equal(validateLifecycleMutation(request), true);
  assert.deepEqual(lifecycleCommandFor(request), [
    "git",
    "update-ref",
    "refs/heads/feature/safe",
    LOCAL,
    LOCAL,
  ]);
  const result = preflightLifecycleMutation({
    request,
    runner: rewriteRunner({ headTip: LOCAL }),
    baselineStore: createMemoryRewriteBaselineStore(),
  });
  assert.equal(result.originalLocalTip, LOCAL);
  assert.deepEqual(authorityScopeForRequest(request), {
    action: "record_rewrite_baseline",
    mutationMode: "maintainer",
    repo: "Wibias/github-delivery",
    remote: "origin",
    branch: "feature/safe",
    originalLocalTip: LOCAL,
  });
});

test("record_rewrite_baseline rejects a request SHA that is not the live branch tip", () => {
  assert.throws(
    () =>
      preflightLifecycleMutation({
        request: recordRequest({ originalLocalTip: LOCAL }),
        runner: rewriteRunner({ headTip: NEXT }),
        baselineStore: createMemoryRewriteBaselineStore(),
      }),
    /original_local_tip_baseline_head_mismatch/,
  );
});

test("record_rewrite_baseline cannot silently replace an existing baseline", () => {
  assert.throws(
    () =>
      preflightLifecycleMutation({
        request: recordRequest(),
        runner: rewriteRunner({ headTip: LOCAL }),
        baselineStore: seededStore(LOCAL),
      }),
    /rewrite_baseline_already_exists/,
  );
});

test("record_rewrite_baseline refuses capture if the branch moves between preflight and mutation", () => {
  const request = recordRequest({ originalLocalTip: LOCAL });
  const store = createMemoryRewriteBaselineStore();
  const command = lifecycleCommandFor(request);
  assert.deepEqual(command, ["git", "update-ref", "refs/heads/feature/safe", LOCAL, LOCAL]);
  assert.equal(
    preflightLifecycleMutation({
      request,
      runner: rewriteRunner({ headTip: LOCAL }),
      baselineStore: store,
    }).originalLocalTip,
    LOCAL,
  );
  assert.throws(
    () =>
      verifyLifecycleMutation({
        request,
        runner: rewriteRunner({ headTip: NEXT }),
        baselineStore: store,
      }),
    /original_local_tip_baseline_head_mismatch/,
  );
  assert.equal(
    store.read({ repo: "Wibias/github-delivery", remote: "origin", branch: "feature/safe" }),
    null,
  );
});

test("record_rewrite_baseline compare-and-swap fails if the branch moves after preflight", () => {
  const store = createMemoryRewriteBaselineStore();
  let headTip = LOCAL;
  const runner = (command, args) => {
    if (command === "git" && args[0] === "check-ref-format") {
      return { status: 0, stdout: "", stderr: "" };
    }
    if (command === "git" && args[0] === "remote") {
      return { status: 0, stdout: "git@github.com:Wibias/github-delivery.git\n", stderr: "" };
    }
    if (command === "gh" && args[0] === "repo") {
      return { status: 0, stdout: JSON.stringify(identityOk()), stderr: "" };
    }
    if (command === "git" && args[0] === "rev-parse") {
      const spec = args[1] === "--verify" ? String(args[2] || "") : String(args[1] || "");
      if (spec === "refs/heads/feature/safe") {
        const tip = headTip;
        headTip = NEXT;
        return { status: 0, stdout: `${tip}\n`, stderr: "" };
      }
    }
    if (command === "git" && args[0] === "update-ref") {
      const oldValue = String(args[3] || "");
      if (oldValue !== headTip) {
        return { status: 1, stdout: "", stderr: "fatal: cannot lock ref" };
      }
      return { status: 0, stdout: "", stderr: "" };
    }
    throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
  };
  assert.throws(
    () =>
      executeLifecycleMutationRequest({
        request: recordRequest(),
        execute: true,
        requireTrustedAuthority: false,
        runner,
        baselineStore: store,
      }),
    /cannot lock ref|mutation_command_failed/,
  );
  assert.equal(
    store.read({ repo: "Wibias/github-delivery", remote: "origin", branch: "feature/safe" }),
    null,
  );
});

test("record_rewrite_baseline post-verify stores the captured SHA in broker state", () => {
  const store = createMemoryRewriteBaselineStore();
  assert.equal(
    verifyLifecycleMutation({
      request: recordRequest(),
      runner: rewriteRunner({ headTip: LOCAL }),
      baselineStore: store,
    }),
    LOCAL,
  );
  assert.equal(
    store.read({ repo: "Wibias/github-delivery", remote: "origin", branch: "feature/safe" }),
    LOCAL,
  );
  assert.throws(
    () =>
      verifyLifecycleMutation({
        request: recordRequest(),
        runner: rewriteRunner({ headTip: LOCAL }),
        baselineStore: store,
      }),
    /rewrite_baseline_already_exists/,
  );
});

test("record_rewrite_baseline rejects a remote that resolves to another repository", () => {
  assert.throws(
    () =>
      preflightLifecycleMutation({
        request: recordRequest(),
        runner: rewriteRunner({
          headTip: LOCAL,
          remoteUrl: "git@github.com:attacker/other.git",
        }),
        baselineStore: createMemoryRewriteBaselineStore(),
      }),
    /push_remote_repo_mismatch/,
  );
});

test("record_rewrite_baseline rejects a missing remote", () => {
  assert.throws(
    () =>
      preflightLifecycleMutation({
        request: recordRequest(),
        runner(command, args) {
          if (command === "git" && args[0] === "check-ref-format") {
            return { status: 0, stdout: "", stderr: "" };
          }
          if (command === "git" && args[0] === "remote") {
            return { status: 1, stdout: "", stderr: "fatal: No such remote 'origin'" };
          }
          throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
        },
        baselineStore: createMemoryRewriteBaselineStore(),
      }),
    /No such remote|mutation_preflight_failed/,
  );
});

test("record_rewrite_baseline accepts an HTTPS remote that matches the authorized repo", () => {
  const result = preflightLifecycleMutation({
    request: recordRequest(),
    runner: rewriteRunner({
      headTip: LOCAL,
      remoteUrl: "https://github.com/Wibias/github-delivery.git",
    }),
    baselineStore: createMemoryRewriteBaselineStore(),
  });
  assert.equal(result.originalLocalTip, LOCAL);
});

test("record_rewrite_baseline accepts an SSH remote that matches the authorized repo", () => {
  const result = preflightLifecycleMutation({
    request: recordRequest(),
    runner: rewriteRunner({ headTip: LOCAL }),
    baselineStore: createMemoryRewriteBaselineStore(),
  });
  assert.equal(result.originalLocalTip, LOCAL);
});

test("fast-forward force-with-lease skips the tree identity check", () => {
  assert.doesNotThrow(() =>
    preflightLifecycleMutation({
      request: pushRequest(),
      runner: rewriteRunner({ ancestor: true }),
    }),
  );
});

test("history-only rewrite reaches push only when trees match", () => {
  const result = preflightLifecycleMutation({
    request: pushRequest(),
    runner: rewriteRunner({ ancestor: false, originalTree: TREE_A, newTree: TREE_A }),
    baselineStore: seededStore(),
  });
  assert.equal(result.newTip, NEXT);
});

test("changed-tree history rewrite cannot reach push_code", () => {
  assert.throws(
    () =>
      preflightLifecycleMutation({
        request: pushRequest(),
        runner: rewriteRunner({ ancestor: false, originalTree: TREE_A, newTree: TREE_B }),
        baselineStore: seededStore(),
      }),
    /content_preserving_rewrite_tree_mismatch/,
  );
});

test("a rewrite that keeps the original local tree is allowed when the remote tree differs", () => {
  const result = preflightLifecycleMutation({
    request: pushRequest(),
    runner: rewriteRunner({
      ancestor: false,
      remoteTree: TREE_A,
      originalTree: TREE_B,
      newTree: TREE_B,
    }),
    baselineStore: seededStore(),
  });
  assert.equal(result.newTip, NEXT);
  assert.equal(result.originalLocalTip, LOCAL);
});

test("a rewrite that drops unpublished local commits back to the remote tree is blocked", () => {
  assert.throws(
    () =>
      preflightLifecycleMutation({
        request: pushRequest(),
        runner: rewriteRunner({
          ancestor: false,
          remoteTree: TREE_A,
          originalTree: TREE_B,
          newTree: TREE_A,
        }),
        baselineStore: seededStore(),
      }),
    /content_preserving_rewrite_tree_mismatch/,
  );
});

test("a stale rewrite baseline cannot approve dropping a later local commit", () => {
  assert.throws(
    () =>
      preflightLifecycleMutation({
        request: pushRequest(),
        runner: rewriteRunner({
          ancestor: false,
          originalTree: TREE_A,
          newTree: TREE_A,
          reflogEntries: [
            { sha: NEXT, tree: TREE_A },
            { sha: MIDDLE, tree: TREE_B },
            { sha: LOCAL, tree: TREE_A },
          ],
        }),
        baselineStore: seededStore(),
      }),
    /rewrite_baseline_generation_stale/,
  );
});

test("a content-preserving squash through an ancestor reflog entry is allowed", () => {
  assert.doesNotThrow(() =>
    preflightLifecycleMutation({
      request: pushRequest(),
      runner: rewriteRunner({
        ancestor: false,
        originalTree: TREE_A,
        newTree: TREE_A,
        reflogEntries: [
          { sha: NEXT, tree: TREE_A },
          { sha: MIDDLE, tree: TREE_B },
          { sha: LOCAL, tree: TREE_A },
        ],
        isAncestor: (candidate, descendant) => candidate === MIDDLE && descendant === LOCAL,
      }),
      baselineStore: seededStore(),
    }),
  );
});

test("a missing branch reflog cannot prove the rewrite started from the baseline", () => {
  assert.throws(
    () =>
      preflightLifecycleMutation({
        request: pushRequest(),
        runner: rewriteRunner({
          ancestor: false,
          originalTree: TREE_A,
          newTree: TREE_A,
          reflogStatus: 128,
        }),
        baselineStore: seededStore(),
      }),
    /rewrite_baseline_generation_unproven/,
  );
});

test("rewrite exemptions skip only tree identity and still require the exact remote lease", () => {
  const request = pushRequest({ rewriteExemption: "restack" });
  assert.doesNotThrow(() =>
    preflightLifecycleMutation({
      request,
      runner: rewriteRunner({
        ancestor: false,
        remoteTree: TREE_A,
        originalTree: TREE_B,
        newTree: TREE_A,
      }),
    }),
  );
  assert.throws(
    () =>
      preflightLifecycleMutation({
        request,
        runner: rewriteRunner({
          ancestor: false,
          remoteTip: OTHER,
          remoteTree: TREE_A,
          originalTree: TREE_B,
          newTree: TREE_A,
        }),
      }),
    /expected_remote_tip_mismatch/,
  );
});

test("restack exemption skips tree identity", () => {
  const request = pushRequest({ rewriteExemption: "restack" });
  assert.equal(validateLifecycleMutation(request), true);
  assert.equal(authorityScopeForRequest(request).rewriteExemption, "restack");
  assert.doesNotThrow(() =>
    preflightLifecycleMutation({
      request,
      runner: rewriteRunner({ ancestor: false, originalTree: TREE_A, newTree: TREE_B }),
    }),
  );
  assert.throws(
    () =>
      preflightLifecycleMutation({
        request: pushRequest(),
        runner: rewriteRunner({ ancestor: false, originalTree: TREE_A, newTree: TREE_B }),
        baselineStore: seededStore(),
      }),
    /content_preserving_rewrite_tree_mismatch/,
  );
});

test("unknown rewrite exemption fails closed", () => {
  assert.throws(
    () => validateLifecycleMutation(pushRequest({ rewriteExemption: "amend" })),
    /rewrite_exemption_invalid/,
  );
});

test("lifecycle and authority share the rewriteExemption accept/reject matrix", () => {
  const omitted = pushRequest();
  const omittedHash = authorityScopeSha256(omitted);
  const cases = [
    [undefined, "omit"],
    [null, "omit"],
    ["", "omit"],
    ["restack", "accept"],
    ["conflicts", "accept"],
    ["simplify-pr", "accept"],
    [" restack ", "reject"],
    [" ", "reject"],
    ["amend", "reject"],
    [["restack"], "reject"],
    [{ kind: "restack" }, "reject"],
    [1, "reject"],
    [true, "reject"],
  ];
  for (const [value, expected] of cases) {
    const request = { ...omitted };
    if (value !== undefined) request.rewriteExemption = value;
    const label = JSON.stringify(value);
    if (expected === "omit") {
      assert.equal(validateLifecycleMutation(request), true, `lifecycle omit ${label}`);
      assert.equal("rewriteExemption" in authorityScopeForRequest(request), false, `authority omit ${label}`);
      assert.equal(authorityScopeSha256(request), omittedHash, `authority hash omit ${label}`);
    } else if (expected === "accept") {
      assert.equal(validateLifecycleMutation(request), true, `lifecycle accept ${label}`);
      assert.equal(authorityScopeForRequest(request).rewriteExemption, value, `authority accept ${label}`);
    } else {
      assert.throws(
        () => validateLifecycleMutation(request),
        /rewrite_exemption_invalid/,
        `lifecycle reject ${label}`,
      );
      assert.throws(
        () => authorityScopeForRequest(request),
        /authority_scope_rewrite_exemption_invalid/,
        `authority reject ${label}`,
      );
    }
  }
});

test("non-string rewrite exemptions cannot bypass tree identity", () => {
  const malformed = [["restack"], { kind: "restack" }, 1, true];
  for (const rewriteExemption of malformed) {
    const request = pushRequest({ rewriteExemption });
    assert.throws(
      () => validateLifecycleMutation(request),
      /rewrite_exemption_invalid/,
      `validate ${JSON.stringify(rewriteExemption)}`,
    );
    assert.throws(
      () =>
        preflightLifecycleMutation({
          request,
          runner: rewriteRunner({ ancestor: false, originalTree: TREE_A, newTree: TREE_B }),
        }),
      /rewrite_exemption_invalid/,
      `preflight ${JSON.stringify(rewriteExemption)}`,
    );
  }
});

function gitAt(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Rewrite Baseline",
      GIT_AUTHOR_EMAIL: "rewrite@example.com",
      GIT_COMMITTER_NAME: "Rewrite Baseline",
      GIT_COMMITTER_EMAIL: "rewrite@example.com",
    },
  });
  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || `git ${args.join(" ")} failed`));
  }
  return String(result.stdout || "").trim();
}

function mixedGitRunner(cwd) {
  return (command, args) => {
    if (command === "gh" && args[0] === "repo") {
      return { status: 0, stdout: JSON.stringify(identityOk()), stderr: "" };
    }
    if (command === "git" && args[0] === "remote") {
      return { status: 0, stdout: "git@github.com:Wibias/github-delivery.git\n", stderr: "" };
    }
    if (command === "git" && args[0] === "check-ref-format") {
      return { status: 0, stdout: "", stderr: "" };
    }
    if (command === "git" && args[0] === "ls-remote") {
      return { status: 0, stdout: `${OLD}\trefs/heads/feature/safe\n`, stderr: "" };
    }
    if (command === "git" && args[0] === "merge-base") {
      if (args[1] === "--is-ancestor") {
        const ancestorSha = String(args[2] || "").toLowerCase();
        const descendantSha = String(args[3] || "").toLowerCase();
        if (ancestorSha === OLD || descendantSha === OLD || ancestorSha === NEXT || descendantSha === NEXT) {
          return { status: 1, stdout: "", stderr: "" };
        }
        const result = spawnSync(command, args, { cwd, encoding: "utf8", windowsHide: true });
        return {
          status: result.status ?? 1,
          stdout: result.stdout || "",
          stderr: result.stderr || "",
        };
      }
      return { status: 1, stdout: "", stderr: "" };
    }
    const result = spawnSync(command, args, { cwd, encoding: "utf8", windowsHide: true });
    return {
      status: result.status ?? 1,
      stdout: result.stdout || "",
      stderr: result.stderr || "",
    };
  };
}


test("record A, commit B, rewrite back to tree(A), then guarded push must reject", () => {
  const cwd = mkdtempSync(join(tmpdir(), "gd-rewrite-generation-"));
  try {
    gitAt(cwd, ["init", "-b", "feature/safe"]);
    gitAt(cwd, ["config", "user.name", "Rewrite Baseline"]);
    gitAt(cwd, ["config", "user.email", "rewrite@example.com"]);
    gitAt(cwd, ["config", "core.logAllRefUpdates", "true"]);
    writeFileSync(join(cwd, "note.txt"), "tree-one\n");
    gitAt(cwd, ["add", "note.txt"]);
    gitAt(cwd, ["commit", "-m", "A"]);
    const commitA = gitAt(cwd, ["rev-parse", "HEAD"]);
    const store = createMemoryRewriteBaselineStore();
    verifyLifecycleMutation({
      request: recordRequest({ originalLocalTip: commitA }),
      runner: mixedGitRunner(cwd),
      baselineStore: store,
    });
    writeFileSync(join(cwd, "note.txt"), "tree-two\n");
    gitAt(cwd, ["add", "note.txt"]);
    gitAt(cwd, ["commit", "-m", "B"]);
    writeFileSync(join(cwd, "note.txt"), "tree-one\n");
    gitAt(cwd, ["add", "note.txt"]);
    gitAt(cwd, ["commit", "-m", "C"]);
    const commitC = gitAt(cwd, ["rev-parse", "HEAD"]);
    assert.notEqual(commitC, commitA);
    assert.throws(
      () =>
        preflightLifecycleMutation({
          request: pushRequest({ originalLocalTip: commitA, newTip: commitC }),
          runner: mixedGitRunner(cwd),
          baselineStore: store,
        }),
      /rewrite_baseline_generation_stale/,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("record C, soft-reset to A, squash, then guarded push must accept", () => {
  const cwd = mkdtempSync(join(tmpdir(), "gd-rewrite-squash-"));
  try {
    gitAt(cwd, ["init", "-b", "feature/safe"]);
    gitAt(cwd, ["config", "user.name", "Rewrite Baseline"]);
    gitAt(cwd, ["config", "user.email", "rewrite@example.com"]);
    gitAt(cwd, ["config", "core.logAllRefUpdates", "true"]);
    writeFileSync(join(cwd, "note.txt"), "tree-one\n");
    gitAt(cwd, ["add", "note.txt"]);
    gitAt(cwd, ["commit", "-m", "A"]);
    const commitA = gitAt(cwd, ["rev-parse", "HEAD"]);
    writeFileSync(join(cwd, "note.txt"), "tree-two\n");
    gitAt(cwd, ["add", "note.txt"]);
    gitAt(cwd, ["commit", "-m", "B"]);
    writeFileSync(join(cwd, "note.txt"), "tree-three\n");
    gitAt(cwd, ["add", "note.txt"]);
    gitAt(cwd, ["commit", "-m", "C"]);
    const commitC = gitAt(cwd, ["rev-parse", "HEAD"]);
    const treeC = gitAt(cwd, ["rev-parse", "HEAD^{tree}"]);
    const store = createMemoryRewriteBaselineStore();
    verifyLifecycleMutation({
      request: recordRequest({ originalLocalTip: commitC }),
      runner: mixedGitRunner(cwd),
      baselineStore: store,
    });
    gitAt(cwd, ["reset", "--soft", commitA]);
    gitAt(cwd, ["commit", "-m", "squash"]);
    const squashed = gitAt(cwd, ["rev-parse", "HEAD"]);
    const squashedTree = gitAt(cwd, ["rev-parse", "HEAD^{tree}"]);
    assert.equal(squashedTree, treeC);
    assert.notEqual(squashed, commitC);
    assert.doesNotThrow(() =>
      preflightLifecycleMutation({
        request: pushRequest({ originalLocalTip: commitC, newTip: squashed }),
        runner: mixedGitRunner(cwd),
        baselineStore: store,
      }),
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
