import assert from "node:assert/strict";
import test from "node:test";

import {
  authorityScopeForRequest,
  authorityScopeSha256,
} from "../../scripts/lib/authority-scope.mjs";
import {
  preflightLifecycleMutation,
  validateLifecycleMutation,
} from "../../scripts/lib/lifecycle-mutations.mjs";

const OLD = "a".repeat(40);
const NEXT = "b".repeat(40);
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

function rewriteRunner({ ancestor = false, originalTree = TREE_A, newTree = TREE_A } = {}) {
  return (command, args) => {
    if (command === "git" && args[0] === "check-ref-format") return { status: 0, stdout: "", stderr: "" };
    if (command === "git" && args[0] === "remote") {
      return { status: 0, stdout: "git@github.com:Wibias/github-delivery.git\n", stderr: "" };
    }
    if (command === "gh" && args[0] === "repo") {
      return { status: 0, stdout: JSON.stringify(identityOk()), stderr: "" };
    }
    if (command === "git" && args[0] === "ls-remote") {
      return { status: 0, stdout: `${OLD}\trefs/heads/feature/safe\n`, stderr: "" };
    }
    if (command === "git" && args[0] === "merge-base") {
      return { status: ancestor ? 0 : 1, stdout: "", stderr: "" };
    }
    if (command === "git" && args[0] === "rev-parse") {
      const spec = String(args[1] || "");
      if (spec.startsWith(OLD)) return { status: 0, stdout: `${originalTree}\n`, stderr: "" };
      if (spec.startsWith(NEXT)) return { status: 0, stdout: `${newTree}\n`, stderr: "" };
    }
    throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
  };
}

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

