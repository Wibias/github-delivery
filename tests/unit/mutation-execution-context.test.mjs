import assert from "node:assert/strict";
import test from "node:test";

import {
  assertScopedTrustedAuthority,
  executeMutationWithAuthority,
  mutationAuthorityOptions,
  mutationRequiresTrustedAuthority,
  planMutationWithAuthority,
} from "../../scripts/lib/mutation-execution-context.mjs";
import {
  lifecycleCommandFor,
  preflightLifecycleMutation,
} from "../../scripts/lib/lifecycle-mutations.mjs";
import {
  boundedSpawnSync,
  DEFAULT_SUBPROCESS_TIMEOUT_MS,
} from "../../scripts/lib/subprocess-policy.mjs";

const scoped = {
  verified: true,
  provenance: "trusted_grant",
  claims: { scopeSha256: "a".repeat(64) },
};

const unscoped = {
  verified: true,
  provenance: "trusted_grant",
  claims: { nonce: "legacy" },
};

function pushRequest(overrides = {}) {
  return {
    schemaVersion: 1,
    action: "push_code",
    mutationMode: "maintainer",
    explicitInstruction: true,
    repo: "Wibias/github-delivery",
    remote: "origin",
    branch: "feature/safe",
    expectedRemoteTip: "a".repeat(40),
    newTip: "b".repeat(40),
    forceWithLease: true,
    ...overrides,
  };
}

test("canonical subprocess policy always applies a finite deadline", () => {
  let observedOptions = null;
  const result = boundedSpawnSync(
    "gh",
    ["api", "repos/acme/widgets"],
    { encoding: "utf8" },
    {
      timeoutMs: 37,
      spawn(_command, _args, options) {
        observedOptions = options;
        return {
          status: null,
          signal: "SIGTERM",
          stdout: "",
          stderr: "",
          error: { code: "ETIMEDOUT" },
        };
      },
    },
  );
  assert.equal(DEFAULT_SUBPROCESS_TIMEOUT_MS > 0, true);
  assert.equal(observedOptions.timeout, 37);
  assert.equal(observedOptions.killSignal, "SIGTERM");
  assert.match(result.stderr, /subprocess_timeout:gh:37ms/);
});

test("caller-specified subprocess deadlines stay bounded and are preserved", () => {
  let observedOptions = null;
  boundedSpawnSync(
    "git",
    ["status"],
    { timeout: 51, killSignal: "SIGKILL" },
    {
      timeoutMs: 999,
      spawn(_command, _args, options) {
        observedOptions = options;
        return { status: 0, stdout: "", stderr: "" };
      },
    },
  );
  assert.equal(observedOptions.timeout, 51);
  assert.equal(observedOptions.killSignal, "SIGKILL");
});

test("strict trusted authority rejects a verified legacy grant without scope binding", () => {
  assert.throws(
    () =>
      assertScopedTrustedAuthority(unscoped, {
        requireTrustedAuthority: true,
      }),
    /trusted_authority_required:scope_hash_missing/,
  );
});

test("strict trusted authority accepts an exact scoped grant", () => {
  assert.equal(
    assertScopedTrustedAuthority(scoped, { requireTrustedAuthority: true }),
    scoped,
  );
});

test("compatibility mode can still inspect a legacy unscoped grant", () => {
  assert.equal(
    assertScopedTrustedAuthority(unscoped, { requireTrustedAuthority: false }),
    unscoped,
  );
});

test("autonomous execution always requires trusted authority", () => {
  assert.equal(
    mutationRequiresTrustedAuthority({
      mutationMode: "autonomous",
      action: "post_comment",
    }),
    true,
  );
});

test("high-assurance lifecycle and social actions require trusted authority", () => {
  for (const action of [
    "push_code",
    "create_pr",
    "update_pr_body",
    "create_issue",
    "assign_issue",
    "resolve_thread",
    "close_linked_issue",
    "close_pr",
    "merge_pr",
    "retarget_pr",
    "delete_head_branch",
    "post_review",
    "post_comment",
    "post_issue_comment",
    "edit_own_comment",
    "reply_bot_thread",
    "reply_human_thread",
    "create_follow_up_issue",
    "post_resolution_record",
  ]) {
    assert.equal(
      mutationRequiresTrustedAuthority({ mutationMode: "review", action }),
      true,
      action,
    );
  }
});

test("social-write authority is enforced at execution even in review mode", () => {
  const request = { mutationMode: "review", action: "post_comment" };
  assert.equal(
    mutationAuthorityOptions({ request, enforceHighAssurance: false }).requireTrustedAuthority,
    false,
  );
  assert.equal(
    mutationAuthorityOptions({ request, enforceHighAssurance: true }).requireTrustedAuthority,
    true,
  );
  assert.equal(
    mutationAuthorityOptions({
      request,
      enforceHighAssurance: false,
      env: { GITHUB_DELIVERY_REQUIRE_TRUSTED_AUTHORITY: "1" },
    }).requireTrustedAuthority,
    true,
  );
});

test("push_code dry-run plans an exact force-with-lease command", () => {
  const plan = planMutationWithAuthority(pushRequest());
  assert.deepEqual(plan.command, [
    "git",
    "push",
    `--force-with-lease=refs/heads/feature/safe:${"a".repeat(40)}`,
    "origin",
    `${"b".repeat(40)}:refs/heads/feature/safe`,
  ]);
});

test("push_code execution cannot reach git without trusted authority", () => {
  let calls = 0;
  assert.throws(
    () => executeMutationWithAuthority({
      request: pushRequest(),
      execute: true,
      runner() {
        calls += 1;
        return { status: 0, stdout: "", stderr: "" };
      },
    }),
    /trusted_authority_required/,
  );
  assert.equal(calls, 0);
});

test("push preflight binds the named remote to the authorized GitHub repository and tip", () => {
  const calls = [];
  const result = preflightLifecycleMutation({
    request: pushRequest(),
    runner(command, args) {
      calls.push([command, ...args]);
      if (command === "git" && args[0] === "check-ref-format") {
        return { status: 0, stdout: "", stderr: "" };
      }
      if (command === "git" && args[0] === "remote") {
        return { status: 0, stdout: "git@github.com:Wibias/github-delivery.git\n", stderr: "" };
      }
      if (command === "gh" && args[0] === "repo") {
        return {
          status: 0,
          stdout: JSON.stringify({
            url: "https://github.com/Wibias/github-delivery",
            sshUrl: "git@github.com:Wibias/github-delivery.git",
          }),
          stderr: "",
        };
      }
      if (command === "git" && args[0] === "ls-remote") {
        return { status: 0, stdout: `${"a".repeat(40)}\trefs/heads/feature/safe\n`, stderr: "" };
      }
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    },
  });
  assert.equal(result.expectedRemoteTip, "a".repeat(40));
  assert.equal(result.newTip, "b".repeat(40));
  assert.ok(calls.some((row) => row[0] === "gh" && row[1] === "repo"));
});

test("push preflight rejects a remote that resolves to another repository", () => {
  assert.throws(
    () => preflightLifecycleMutation({
      request: pushRequest(),
      runner(command, args) {
        if (command === "git" && args[0] === "check-ref-format") return { status: 0, stdout: "", stderr: "" };
        if (command === "git" && args[0] === "remote") {
          return { status: 0, stdout: "git@github.com:attacker/other.git\n", stderr: "" };
        }
        if (command === "gh" && args[0] === "repo") {
          return {
            status: 0,
            stdout: JSON.stringify({
              url: "https://github.com/Wibias/github-delivery",
              sshUrl: "git@github.com:Wibias/github-delivery.git",
            }),
            stderr: "",
          };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
    }),
    /push_remote_repo_mismatch/,
  );
});

test("create_pr lifecycle command is broker-shaped rather than an ad-hoc shell string", () => {
  const command = lifecycleCommandFor({
    action: "create_pr",
    repo: "Wibias/github-delivery",
    base: "main",
    head: "feature/safe",
    title: "Safe PR",
    body: "Body",
    draft: true,
  });
  assert.deepEqual(command.slice(0, 6), ["gh", "pr", "create", "--repo", "Wibias/github-delivery", "--base"]);
  assert.ok(command.includes("--draft"));
});
