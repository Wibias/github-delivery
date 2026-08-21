import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AUTONOMOUS_CLAIM_RECOVERY_AGE_MS,
  acquireAutonomousIdempotencyClaim,
  verifyAutonomousIdempotencyClaim,
} from "../../scripts/lib/autonomous-idempotency-claim.mjs";
import { executeMutationDocument } from "../../scripts/lib/mutation-document-execution.mjs";
import { verifyLegacyMutationPostcondition } from "../../scripts/lib/mutation-postconditions.mjs";
import { combineShipGateResults } from "../../scripts/lib/ship-gate-policy.mjs";
import { routeShippingGithubPrompt } from "../../scripts/lib/skill-router.mjs";
import {
  assertSameMergeBoundary,
  mergeBoundaryForSnapshot,
} from "../../scripts/lib/merge-boundary.mjs";
import { DEFAULT_USER_CONFIG } from "../../scripts/lib/user-config.mjs";
import { executeMergeTransaction } from "../../scripts/merge-pr-driver.mjs";
import { verifyExistingRelease } from "../../scripts/verify-existing-release.mjs";

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const RULES = "c".repeat(64);

function readyComponent(extra = {}) {
  return {
    decision: "ready",
    complete: true,
    blockers: [],
    unknowns: [],
    ...extra,
  };
}

function readyShipInput(snapshot) {
  return {
    snapshot,
    mutationProfile: { mode: "maintainer" },
    requiredChecks: readyComponent(),
    baseHealth: readyComponent(),
    reviewPolicy: readyComponent({ mergeQueue: { enabled: false } }),
    reviewThreads: readyComponent(),
    wake: readyComponent(),
    codeowners: { decision: "ready", complete: true, ownersUnion: [], codeownersErrors: [] },
  };
}

function mergeSnapshot(feedback = {}) {
  return {
    headOid: HEAD,
    evidence: {
      captureBoundary: {
        headOid: HEAD,
        baseRefName: "main",
        baseOid: BASE,
        rulesFingerprint: RULES,
      },
      pullRequest: {
        mergeStateStatus: "CLEAN",
        reviewDecision: "APPROVED",
        updatedAt: "2026-08-16T00:00:00Z",
      },
      activeRules: [
        {
          type: "required_status_checks",
          parameters: { strict_required_status_checks_policy: true },
        },
      ],
      policy: { mergeQueue: { enabled: false } },
      feedback: {
        issueComments: [],
        reviewComments: [],
        reviews: [],
        reviewThreads: [],
        ...feedback,
      },
    },
  };
}

test("secure authority is the default when the user has not opted out", () => {
  assert.deepEqual(DEFAULT_USER_CONFIG, {
    schemaVersion: 1,
    authorityMode: "high-assurance",
  });
});

test("public mutation documents cannot execute or plan merge_pr directly", () => {
  assert.throws(
    () => executeMutationDocument({
      document: {
        schemaVersion: 1,
        action: "merge_pr",
        mutationMode: "maintainer",
        explicitInstruction: true,
        repo: "acme/widgets",
        pr: 42,
        expectedHead: HEAD,
      },
    }),
    /merge_pr_requires_merge_driver/,
  );
});

test("unknown active GitHub merge rules make the ship gate unknown", () => {
  const snapshot = {
    headOid: HEAD,
    evidence: {
      pullRequest: { mergeStateStatus: "CLEAN" },
      activeRules: [{ type: "required_deployments", parameters: {} }],
    },
  };
  const gate = combineShipGateResults(readyShipInput(snapshot));
  assert.equal(gate.ready, false);
  assert.equal(gate.decision, "unknown");
  assert.ok(gate.unknowns.includes("policy:unsupported_active_ruleset_rule:required_deployments"));
});

test("an unexplained GitHub BLOCKED merge state never becomes ready", () => {
  const snapshot = {
    headOid: HEAD,
    evidence: { pullRequest: { mergeStateStatus: "BLOCKED" }, activeRules: [] },
  };
  const gate = combineShipGateResults(readyShipInput(snapshot));
  assert.equal(gate.ready, false);
  assert.ok(gate.unknowns.includes("policy:github_merge_state_blocked"));
});

test("an unexplained GitHub UNKNOWN merge state never becomes ready", () => {
  const snapshot = {
    headOid: HEAD,
    evidence: { pullRequest: { mergeStateStatus: "UNKNOWN" }, activeRules: [] },
  };
  const gate = combineShipGateResults(readyShipInput(snapshot));
  assert.equal(gate.ready, false);
  assert.equal(gate.decision, "unknown");
  assert.ok(gate.unknowns.includes("policy:github_merge_state_unknown"));
});

test("a missing GitHub merge state never becomes ready", () => {
  const snapshot = {
    headOid: HEAD,
    evidence: { pullRequest: {}, activeRules: [] },
  };
  const gate = combineShipGateResults(readyShipInput(snapshot));
  assert.equal(gate.ready, false);
  assert.ok(gate.unknowns.includes("policy:github_merge_state_unknown"));
});

test("an empty GitHub merge state never becomes ready", () => {
  const snapshot = {
    headOid: HEAD,
    evidence: { pullRequest: { mergeStateStatus: "" }, activeRules: [] },
  };
  const gate = combineShipGateResults(readyShipInput(snapshot));
  assert.equal(gate.ready, false);
  assert.ok(gate.unknowns.includes("policy:github_merge_state_unknown"));
});

test("an unrecognised GitHub merge state never becomes ready", () => {
  const snapshot = {
    headOid: HEAD,
    evidence: { pullRequest: { mergeStateStatus: "FUTURE_STATE" }, activeRules: [] },
  };
  const gate = combineShipGateResults(readyShipInput(snapshot));
  assert.equal(gate.ready, false);
  assert.ok(gate.unknowns.includes("policy:github_merge_state_unknown"));
});

test("a DRAFT GitHub merge state never becomes ready even when isDraft is false", () => {
  const snapshot = {
    headOid: HEAD,
    evidence: {
      pullRequest: { mergeStateStatus: "DRAFT", isDraft: false },
      activeRules: [],
    },
  };
  const gate = combineShipGateResults(readyShipInput(snapshot));
  assert.equal(gate.ready, false);
  assert.ok(gate.unknowns.includes("policy:github_merge_state_unknown"));
});

test("a CLEAN GitHub merge state can still be ready", () => {
  const snapshot = {
    headOid: HEAD,
    evidence: { pullRequest: { mergeStateStatus: "CLEAN" }, activeRules: [] },
  };
  const gate = combineShipGateResults(readyShipInput(snapshot));
  assert.equal(gate.ready, true);
  assert.equal(gate.decision, "ready");
});

test("DIRTY merge state is left to wake and does not add a combiner unknown", () => {
  const snapshot = {
    headOid: HEAD,
    evidence: { pullRequest: { mergeStateStatus: "DIRTY" }, activeRules: [] },
  };
  const gate = combineShipGateResults(readyShipInput(snapshot));
  assert.equal(gate.decision, "ready");
  assert.equal(
    gate.unknowns.includes("policy:github_merge_state_unknown"),
    false,
  );
  assert.equal(
    gate.unknowns.includes("policy:github_merge_state_blocked"),
    false,
  );
});

test("failing required checks stay blocked when GitHub merge state is UNKNOWN", () => {
  const snapshot = {
    headOid: HEAD,
    evidence: { pullRequest: { mergeStateStatus: "UNKNOWN" }, activeRules: [] },
  };
  const gate = combineShipGateResults({
    ...readyShipInput(snapshot),
    requiredChecks: {
      decision: "blocked",
      complete: true,
      blockers: ["fail:build"],
      unknowns: [],
    },
  });
  assert.equal(gate.ready, false);
  assert.equal(gate.decision, "blocked");
});

test("merge boundary invalidates when trusted feedback changes without a head change", () => {
  const approved = mergeBoundaryForSnapshot(mergeSnapshot());
  const changed = mergeSnapshot({
    issueComments: [
      {
        id: 99,
        author: { login: "maintainer" },
        body: "Do not merge yet",
        updatedAt: "2026-08-16T00:01:00Z",
      },
    ],
  });
  assert.throws(
    () => assertSameMergeBoundary(approved, changed),
    /merge_boundary_moved:feedbackFingerprint/,
  );
});

test("research plus implementation routes to the implementation workflow with its research preflight", () => {
  const route = routeShippingGithubPrompt("research and implement issue #90 on the latest development branch");
  assert.equal(route?.workflow, "references/create-pr-for-issue.md");
  assert.equal(route?.mutationMode, "maintainer");
});

test("semantic postcondition verification rejects a close that remained open", () => {
  assert.throws(
    () => verifyLegacyMutationPostcondition({
      request: { action: "close_pr", repo: "acme/widgets", pr: 42 },
      receipt: { executed: true, status: "succeeded" },
      runner() {
        return {
          status: 0,
          stdout: JSON.stringify({ state: "OPEN", closedAt: null }),
          stderr: "",
        };
      },
    }),
    /close_pr_postcondition_failed:not_closed/,
  );
});

test("merge transaction records post-merge ceremony failure without losing merge success", () => {
  const calls = [];
  const receipts = executeMergeTransaction({
    mergeRequest: { action: "merge_pr" },
    thankRequest: { action: "post_comment" },
    beforeMerge() {
      calls.push("boundary");
    },
    executeRequest(request) {
      calls.push(request.action);
      if (request.action === "merge_pr") {
        return { action: "merge_pr", status: "succeeded", outcome: "merged" };
      }
      throw new Error("HTTP 429");
    },
  });
  assert.deepEqual(calls, ["boundary", "merge_pr", "post_comment"]);
  assert.equal(receipts[0].receipt.outcome, "merged");
  assert.match(receipts[1].error, /429/);
});

test("existing GitHub release is reused only when asset digests match local files", () => {
  const directory = mkdtempSync(join(tmpdir(), "github-delivery-release-test-"));
  try {
    const file = join(directory, "artifact.zip");
    writeFileSync(file, "release bytes");
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
    const verified = verifyExistingRelease({
      repo: "acme/widgets",
      tag: "v1.2.3",
      files: [file],
      release: {
        tag_name: "v1.2.3",
        draft: false,
        assets: [{ name: "artifact.zip", digest: `sha256:${digest}` }],
      },
    });
    assert.equal(verified.status, "verified_existing_release");
    assert.throws(
      () => verifyExistingRelease({
        repo: "acme/widgets",
        tag: "v1.2.3",
        files: [file],
        release: {
          tag_name: "v1.2.3",
          draft: false,
          assets: [{ name: "artifact.zip", digest: "sha256:deadbeef" }],
        },
      }),
      /release_asset_digest_mismatch/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("declared Node 26 support is bounded inside canonical Node 24 Ubuntu CI", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(workflow, /name: Node 24 \/ ubuntu-latest/);
  assert.match(workflow, /name: Node 22 \/ ubuntu-latest/);
  assert.doesNotMatch(workflow, /\bmatrix:/);
  assert.match(workflow, /Set up Node\.js 26 compatibility runtime[\s\S]*node-version: 26/);
  assert.match(
    workflow,
    /Verify Node 26 compatibility[\s\S]*node scripts\/check-syntax\.mjs && npm run package:check && npm test/,
  );
});

test("nested npm publishing tool is covered by Dependabot", () => {
  const dependabot = readFileSync(".github/dependabot.yml", "utf8");
  assert.match(dependabot, /directory: "\/\.github\/npm-publish"/);
});

test("legacy stack helper files cannot instruct direct remote mutations", () => {
  for (const path of ["references/restack-stack.md", "references/merge-stack.md"]) {
    const text = readFileSync(path, "utf8");
    assert.doesNotMatch(text, /^\s*git push(?:\s|$)/m);
    assert.doesNotMatch(text, /^\s*gh api\b.*(?:-X|--method)\s+(?:PATCH|POST|PUT|DELETE)/m);
  }
});

function claimRequest() {
  return {
    action: "post_comment",
    mutationMode: "autonomous",
    repo: "acme/widgets",
    pr: 42,
    expectedHead: HEAD,
    idempotencyKey: "claim-key",
    body: "status\n\n<!-- github-delivery:idempotency 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef -->",
  };
}

function freshClaimRunner({ conflictFirst = false, oldMessage = null } = {}) {
  const state = {
    calls: [],
    tagMessages: [],
    createRefAttempts: 0,
    oldMessage,
    refObject: conflictFirst ? "old-tag-object" : null,
  };
  function runner(command, args) {
    state.calls.push([command, ...args]);
    const endpoint = String(args[1] || "");
    if (args[0] === "api" && endpoint.endsWith("/git/tags") && args.includes("POST")) {
      const messageArg = args.find((value) => String(value).startsWith("message="));
      state.tagMessages.push(String(messageArg || "").slice("message=".length));
      const sha = `new-tag-object-${state.tagMessages.length}`;
      return { status: 0, stdout: JSON.stringify({ sha }), stderr: "" };
    }
    if (args[0] === "api" && endpoint.endsWith("/git/refs") && args.includes("POST")) {
      state.createRefAttempts += 1;
      if (conflictFirst && state.createRefAttempts === 1) {
        return { status: 1, stdout: "", stderr: "HTTP 422: Reference already exists" };
      }
      const shaArg = args.find((value) => String(value).startsWith("sha="));
      state.refObject = String(shaArg || "").slice(4);
      return { status: 0, stdout: JSON.stringify({ ref: "claim" }), stderr: "" };
    }
    if (args[0] === "api" && endpoint.includes("/git/ref/github-delivery/idempotency/")) {
      return {
        status: 0,
        stdout: JSON.stringify({ object: { type: "tag", sha: state.refObject } }),
        stderr: "",
      };
    }
    if (args[0] === "api" && endpoint.includes("/git/tags/")) {
      const message = state.refObject === "old-tag-object"
        ? state.oldMessage
        : state.tagMessages.at(-1);
      return { status: 0, stdout: JSON.stringify({ message }), stderr: "" };
    }
    if (args[0] === "api" && endpoint.includes("/git/refs/github-delivery/idempotency/") && args.includes("DELETE")) {
      state.refObject = null;
      return { status: 0, stdout: "", stderr: "" };
    }
    throw new Error(`unexpected claim command: ${command} ${args.join(" ")}`);
  }
  return { state, runner };
}

test("new autonomous claims carry durable creation metadata and can be reverified", () => {
  const mock = freshClaimRunner();
  const claim = acquireAutonomousIdempotencyClaim({
    request: claimRequest(),
    runner: mock.runner,
    now: Date.parse("2026-08-16T00:00:00Z"),
  });
  assert.equal(claim.status, "claimed");
  assert.match(mock.state.tagMessages[0], /github-delivery\/autonomous-idempotency-claim/);
  const verified = verifyAutonomousIdempotencyClaim({
    request: claimRequest(),
    claim,
    runner: mock.runner,
  });
  assert.equal(verified.objectSha, claim.objectSha);
});

test("stale autonomous claim is recoverable but a fresh competing claim is not", () => {
  const seed = freshClaimRunner();
  const oldTime = Date.parse("2026-08-16T00:00:00Z");
  acquireAutonomousIdempotencyClaim({ request: claimRequest(), runner: seed.runner, now: oldTime });
  const oldMessage = seed.state.tagMessages[0];

  const freshConflict = freshClaimRunner({ conflictFirst: true, oldMessage });
  assert.throws(
    () => acquireAutonomousIdempotencyClaim({
      request: claimRequest(),
      runner: freshConflict.runner,
      now: oldTime + AUTONOMOUS_CLAIM_RECOVERY_AGE_MS - 1,
    }),
    /autonomous_idempotency_claim_conflict/,
  );

  const stale = freshClaimRunner({ conflictFirst: true, oldMessage });
  const recovered = acquireAutonomousIdempotencyClaim({
    request: claimRequest(),
    runner: stale.runner,
    now: oldTime + AUTONOMOUS_CLAIM_RECOVERY_AGE_MS + 1,
  });
  assert.equal(recovered.status, "recovered_stale_claim");
  assert.ok(stale.state.calls.some((call) => call.includes("DELETE")));
});
