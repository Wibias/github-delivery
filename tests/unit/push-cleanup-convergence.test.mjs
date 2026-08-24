import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { executeLifecycleMutationRequest } from "../../scripts/lib/github-lifecycle-mutation-broker.mjs";
import {
  createFileRewriteBaselineStore,
  createMemoryRewriteBaselineStore,
} from "../../scripts/lib/rewrite-baseline-store.mjs";

const SCOPE = { repo: "Wibias/github-delivery", remote: "origin", branch: "feature/safe" };
const OLD = "a".repeat(40);
const NEW = "b".repeat(40);
const BASELINE = "e".repeat(40);
const OTHER = "f".repeat(40);

function pushRequest() {
  return {
    schemaVersion: 1,
    action: "push_code",
    mutationMode: "maintainer",
    repo: SCOPE.repo,
    remote: SCOPE.remote,
    branch: SCOPE.branch,
    expectedRemoteTip: OLD,
    originalLocalTip: BASELINE,
    newTip: NEW,
    forceWithLease: true,
  };
}

function flakyCleanupStore() {
  const inner = createMemoryRewriteBaselineStore();
  inner.create(SCOPE, BASELINE);
  let failNextConsume = true;
  return {
    read(scope) {
      return inner.read(scope);
    },
    create(scope, sha) {
      return inner.create(scope, sha);
    },
    consume(scope, expected) {
      if (failNextConsume) {
        failNextConsume = false;
        throw new Error("injected_cleanup_failure");
      }
      return inner.consume(scope, expected);
    },
  };
}

function repoIdentityResult() {
  return {
    status: 0,
    stdout: JSON.stringify({
      url: "https://github.com/Wibias/github-delivery",
      sshUrl: "git@github.com:Wibias/github-delivery.git",
    }),
    stderr: "",
  };
}

function statefulPushRunner() {
  let remoteTip = OLD;
  let pushCount = 0;
  return {
    runner(command, args) {
      if (command === "git" && args[0] === "check-ref-format") {
        return { status: 0, stdout: "", stderr: "" };
      }
      if (command === "git" && args[0] === "remote") {
        return { status: 0, stdout: "git@github.com:Wibias/github-delivery.git\n", stderr: "" };
      }
      if (command === "gh" && args[0] === "repo") return repoIdentityResult();
      if (command === "git" && args[0] === "ls-remote") {
        return {
          status: 0,
          stdout: `${remoteTip}\trefs/heads/${SCOPE.branch}\n`,
          stderr: "",
        };
      }
      if (command === "git" && args[0] === "merge-base") {
        return { status: 1, stdout: "", stderr: "" };
      }
      if (command === "git" && args[0] === "rev-parse") {
        return { status: 0, stdout: `${BASELINE}\n`, stderr: "" };
      }
      if (command === "git" && args[0] === "log") {
        return {
          status: 0,
          stdout: `${NEW} ${BASELINE}\n${BASELINE} ${BASELINE}\n`,
          stderr: "",
        };
      }
      if (command === "git" && args[0] === "push") {
        pushCount += 1;
        remoteTip = NEW;
        return { status: 0, stdout: "", stderr: "" };
      }
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    },
    pushCount() {
      return pushCount;
    },
  };
}

function alreadyAppliedContentChangingRunner() {
  return (command, args) => {
    if (command === "git" && args[0] === "check-ref-format") {
      return { status: 0, stdout: "", stderr: "" };
    }
    if (command === "git" && args[0] === "remote") {
      return { status: 0, stdout: "git@github.com:Wibias/github-delivery.git\n", stderr: "" };
    }
    if (command === "gh" && args[0] === "repo") return repoIdentityResult();
    if (command === "git" && args[0] === "ls-remote") {
      return {
        status: 0,
        stdout: `${NEW}\trefs/heads/${SCOPE.branch}\n`,
        stderr: "",
      };
    }
    if (command === "git" && args[0] === "merge-base") {
      return { status: 1, stdout: "", stderr: "" };
    }
    if (command === "git" && args[0] === "rev-parse") {
      const tree = String(args[1] || "").startsWith(NEW) ? OTHER : BASELINE;
      return { status: 0, stdout: `${tree}\n`, stderr: "" };
    }
    throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
  };
}

test("a successful push whose cleanup fails converges on exact retry without pushing twice", () => {
  const store = flakyCleanupStore();
  const stateful = statefulPushRunner();

  assert.throws(
    () =>
      executeLifecycleMutationRequest({
        request: pushRequest(),
        execute: true,
        requireTrustedAuthority: false,
        runner: stateful.runner,
        baselineStore: store,
      }),
    /injected_cleanup_failure/,
  );
  assert.equal(stateful.pushCount(), 1);
  assert.equal(store.read(SCOPE), BASELINE);

  const retry = executeLifecycleMutationRequest({
    request: pushRequest(),
    execute: true,
    requireTrustedAuthority: false,
    runner: stateful.runner,
    baselineStore: store,
  });

  assert.equal(retry.status, "already_applied");
  assert.equal(retry.executed, false);
  assert.equal(retry.verification, NEW);
  assert.equal(stateful.pushCount(), 1);
  assert.equal(store.read(SCOPE), null);
});

test("already-applied recovery re-runs rewrite safety instead of bypassing it", () => {
  const store = createMemoryRewriteBaselineStore();
  store.create(SCOPE, BASELINE);

  assert.throws(
    () =>
      executeLifecycleMutationRequest({
        request: pushRequest(),
        execute: true,
        requireTrustedAuthority: false,
        runner: alreadyAppliedContentChangingRunner(),
        baselineStore: store,
      }),
    /content_preserving_rewrite_tree_mismatch/,
  );
  assert.equal(store.read(SCOPE), BASELINE);
});

test("rewrite baseline consume is compare-and-swap when an expected SHA is supplied", () => {
  const store = createMemoryRewriteBaselineStore();
  store.create(SCOPE, BASELINE);

  assert.throws(
    () => store.consume(SCOPE, OTHER),
    /rewrite_baseline_consume_mismatch/,
  );
  assert.equal(store.read(SCOPE), BASELINE);
  assert.equal(store.consume(SCOPE, BASELINE), BASELINE);
  assert.equal(store.read(SCOPE), null);
});

test("file baseline CAS round trip uses native filesystem semantics", () => {
  const root = mkdtempSync(join(tmpdir(), "gd-rewrite-publish-"));
  const store = createFileRewriteBaselineStore({
    path: join(root, "rewrite-baselines.json"),
  });

  assert.equal(store.create(SCOPE, BASELINE), BASELINE);
  assert.equal(store.read(SCOPE), BASELINE);
  assert.throws(
    () => store.consume(SCOPE, OTHER),
    /rewrite_baseline_consume_mismatch/,
  );
  assert.equal(store.read(SCOPE), BASELINE);
  assert.equal(store.consume(SCOPE, BASELINE), BASELINE);
  assert.equal(store.read(SCOPE), null);
});
