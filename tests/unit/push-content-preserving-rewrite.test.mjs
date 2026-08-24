import assert from "node:assert/strict";
import test from "node:test";

import {
  authorityScopeForRequest,
  authorityScopeSha256,
} from "../../scripts/lib/authority-scope.mjs";
import {
  lifecycleCommandFor,
  preflightLifecycleMutation,
  validateLifecycleMutation,
  verifyLifecycleMutation,
} from "../../scripts/lib/lifecycle-mutations.mjs";
import { rewriteBaselineRef } from "../../scripts/lib/rewrite-baseline.mjs";

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

function rewriteRunner({
  ancestor = false,
  remoteTip = OLD,
  remoteTree = TREE_A,
  originalTree = TREE_A,
  newTree = TREE_A,
  baselineTip = LOCAL,
  baselineMissing = false,
  headTip = LOCAL,
} = {}) {
  const baselineRef = rewriteBaselineRef("origin", "feature/safe");
  return (command, args) => {
    if (command === "git" && args[0] === "check-ref-format") return { status: 0, stdout: "", stderr: "" };
    if (command === "git" && args[0] === "remote") {
      return { status: 0, stdout: "git@github.com:Wibias/github-delivery.git\n", stderr: "" };
    }
    if (command === "gh" && args[0] === "repo") {
      return { status: 0, stdout: JSON.stringify(identityOk()), stderr: "" };
    }
    if (command === "git" && args[0] === "ls-remote") {
      return { status: 0, stdout: `${remoteTip}\trefs/heads/feature/safe\n`, stderr: "" };
    }
    if (command === "git" && args[0] === "merge-base") {
      return { status: ancestor ? 0 : 1, stdout: "", stderr: "" };
    }
    if (command === "git" && args[0] === "update-ref") {
      return { status: 0, stdout: "", stderr: "" };
    }
    if (command === "git" && args[0] === "rev-parse") {
      const spec = args[1] === "--verify" ? String(args[2] || "") : String(args[1] || "");
      if (spec === baselineRef || spec.startsWith("refs/github-delivery/rewrite-baseline/")) {
        if (baselineMissing) return { status: 128, stdout: "", stderr: "missing" };
        return { status: 0, stdout: `${baselineTip}\n`, stderr: "" };
      }
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
        runner: rewriteRunner({
          ancestor: false,
          baselineTip: NEXT,
          originalTree: TREE_A,
          newTree: TREE_A,
        }),
      }),
    /original_local_tip_tautological/,
  );
});

test("history-only rewrite without a broker rewrite baseline cannot reach push_code", () => {
  assert.throws(
    () =>
      preflightLifecycleMutation({
        request: pushRequest(),
        runner: rewriteRunner({
          ancestor: false,
          baselineMissing: true,
          originalTree: TREE_A,
          newTree: TREE_A,
        }),
      }),
    /original_local_tip_baseline_required/,
  );
});

test("push_code originalLocalTip must match the broker-owned rewrite baseline", () => {
  assert.throws(
    () =>
      preflightLifecycleMutation({
        request: pushRequest({ originalLocalTip: NEXT }),
        runner: rewriteRunner({
          ancestor: false,
          baselineTip: LOCAL,
          originalTree: TREE_A,
          newTree: TREE_A,
        }),
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
    rewriteBaselineRef("origin", "feature/safe"),
    LOCAL,
    "0".repeat(40),
  ]);
  const result = preflightLifecycleMutation({
    request,
    runner: rewriteRunner({ headTip: LOCAL, baselineMissing: true }),
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
        runner: rewriteRunner({ headTip: NEXT, baselineMissing: true }),
      }),
    /original_local_tip_baseline_head_mismatch/,
  );
});

test("record_rewrite_baseline cannot silently replace an existing baseline", () => {
  assert.throws(
    () =>
      preflightLifecycleMutation({
        request: recordRequest(),
        runner: rewriteRunner({ headTip: LOCAL, baselineMissing: false, baselineTip: LOCAL }),
      }),
    /rewrite_baseline_already_exists/,
  );
});

test("record_rewrite_baseline command still records the preflight SHA if the branch moves later", () => {
  const request = recordRequest({ originalLocalTip: LOCAL });
  const command = lifecycleCommandFor(request);
  assert.equal(command.includes("refs/heads/feature/safe"), false);
  assert.equal(command[3], LOCAL);
  assert.throws(
    () =>
      preflightLifecycleMutation({
        request,
        runner: rewriteRunner({ headTip: NEXT, baselineMissing: true }),
      }),
    /original_local_tip_baseline_head_mismatch/,
  );
});

test("record_rewrite_baseline post-verify requires the stored ref to equal the captured SHA", () => {
  assert.throws(
    () =>
      verifyLifecycleMutation({
        request: recordRequest(),
        runner: rewriteRunner({ baselineTip: NEXT, baselineMissing: false }),
      }),
    /rewrite_baseline_verification_failed/,
  );
  assert.equal(
    verifyLifecycleMutation({
      request: recordRequest(),
      runner: rewriteRunner({ baselineTip: LOCAL, baselineMissing: false }),
    }),
    LOCAL,
  );
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
  });
  assert.equal(result.newTip, NEXT);
});

test("changed-tree history rewrite cannot reach push_code", () => {
  assert.throws(
    () =>
      preflightLifecycleMutation({
        request: pushRequest(),
        runner: rewriteRunner({ ancestor: false, originalTree: TREE_A, newTree: TREE_B }),
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
      }),
    /content_preserving_rewrite_tree_mismatch/,
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

