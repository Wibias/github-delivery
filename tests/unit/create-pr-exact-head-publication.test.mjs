import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildCreatePrPublicationPlan } from "../../scripts/lib/create-pr-publication-plan.mjs";
import {
  assertCreatePrPublicationComplete,
  createPrPublicationPlanLock,
  createPrPublicationVerificationKey,
} from "../../scripts/lib/create-pr-publication-state.mjs";
import {
  createDeliveryWorkflowController,
  readDeliveryWorkflowCheckpoint,
  writeDeliveryWorkflowCheckpoint,
} from "../../scripts/lib/delivery-workflow-controller.mjs";
import { resolveDeliveryWorkflowProfile } from "../../scripts/lib/delivery-workflow-profiles.mjs";
import {
  lockCreatePrPublicationPlanCheckpoint,
  mutationExecutionContextFromCheckpoint,
  reconcileMutationCheckpoint,
  replanCreatePrPublicationPlanCheckpoint,
} from "../../scripts/lib/mutation-checkpoint.mjs";
import {
  preflightLifecycleMutation,
  validateLifecycleMutation,
  verifyPublishedHead,
} from "../../scripts/lib/lifecycle-mutations.mjs";
import { planLifecycleMutationRequest } from "../../scripts/lib/github-lifecycle-mutation-broker.mjs";
import { mutationOperationKey } from "../../scripts/lib/mutation-document-execution.mjs";

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);
const MOVED = "c".repeat(40);
const REPO = "acme/widgets";
const BRANCH = "feature/widgets";
const BASE_REF = "main";
const PLANNER = fileURLToPath(
  new URL("../../scripts/create-pr-publication-plan.mjs", import.meta.url),
);

function hygienePasses() {
  return {
    noComments: { status: "done", headSha: HEAD, recordedAt: 1 },
    simplify: { status: "done", headSha: HEAD, recordedAt: 1 },
  };
}

function readyGate(overrides = {}) {
  return {
    decision: "ready",
    repo: REPO,
    baseRef: BASE_REF,
    headRef: BRANCH,
    baseRefOid: BASE,
    headRefOid: HEAD,
    diffIdentity: `sha256:${"d".repeat(64)}`,
    fileCount: 2,
    ...overrides,
  };
}

function checkpointSnapshot({ hygiene = true, gate = true, forceOpen = false } = {}) {
  const profile = resolveDeliveryWorkflowProfile("create-pr-from-local-work");
  const current = createDeliveryWorkflowController({
    workflow: profile.workflow,
    repo: REPO,
    baseSha: BASE,
    headSha: HEAD,
    graph: profile.graph,
    startPhase: forceOpen ? "OPEN_PR" : "PREOPEN_GATE",
    ...(hygiene ? { hygienePasses: hygienePasses() } : {}),
  });
  if (gate) current.recordPreOpenGate(readyGate());
  if (!forceOpen && hygiene && gate) current.transition("OPEN_PR");
  return current.snapshot();
}

function writeCheckpoint(directory, snapshot) {
  const path = join(directory, "controller.json");
  writeDeliveryWorkflowCheckpoint(path, snapshot);
  return path;
}

function withTemp(fn) {
  const directory = mkdtempSync(join(tmpdir(), "github-delivery-exact-head-"));
  try {
    return fn(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function exactPlan(checkpoint, overrides = {}) {
  return buildCreatePrPublicationPlan({
    publicationMode: "already-published",
    repo: REPO,
    remote: "origin",
    branch: BRANCH,
    base: BASE_REF,
    publishedSha: HEAD,
    title: "Fix widgets",
    body: "Body",
    idempotencyKey: "create-pr-feature-widgets",
    checkpoint,
    ...overrides,
  });
}

function pushPlan(checkpoint, overrides = {}) {
  return buildCreatePrPublicationPlan({
    repo: REPO,
    remote: "origin",
    branch: BRANCH,
    base: BASE_REF,
    expectedRemoteTip: MOVED,
    originalLocalTip: HEAD,
    newTip: HEAD,
    title: "Fix widgets",
    body: "Body",
    idempotencyKey: "create-pr-feature-widgets",
    checkpoint,
    ...overrides,
  });
}

function runner({
  branchSha = HEAD,
  baseSha = BASE,
  ancestry = "ahead",
  repoUrl = "https://github.com/acme/widgets.git",
  repoView = { url: "https://github.com/acme/widgets", sshUrl: "git@github.com:acme/widgets.git" },
  pulls = [],
  failRead = null,
} = {}) {
  return (command, args) => {
    const ok = (stdout) => ({ status: 0, stdout, stderr: "" });
    if (failRead && command === failRead.command && args.join(" ") === failRead.args) {
      throw new Error(failRead.message);
    }
    if (command === "git" && args[0] === "remote" && args[1] === "get-url") {
      return ok(`${repoUrl}\n`);
    }
    if (command === "gh" && args[0] === "repo" && args[1] === "view") {
      return ok(JSON.stringify(repoView));
    }
    if (command === "git" && args[0] === "check-ref-format") return ok("");
    if (command === "git" && args[0] === "ls-remote") {
      const ref = String(args[3] || "");
      if (ref === `refs/heads/${BRANCH}`) {
        return ok(branchSha === "absent" ? "" : `${branchSha}\t${ref}\n`);
      }
      if (ref === `refs/heads/${BASE_REF}`) {
        return ok(baseSha === "absent" ? "" : `${baseSha}\t${ref}\n`);
      }
      throw new Error(`unexpected ls-remote ${ref}`);
    }
    if (command === "gh" && args[0] === "api") {
      if (String(args[1]).includes("/pulls?")) return ok(JSON.stringify([pulls]));
      if (String(args[1]).includes("/compare/")) return ok(`${ancestry}\n`);
    }
    throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
  };
}

function duplicatePull() {
  return {
    number: 391,
    html_url: "https://github.com/acme/widgets/pull/391",
    state: "open",
    head: { ref: BRANCH, repo: { full_name: REPO } },
    base: { ref: BASE_REF, repo: { full_name: REPO } },
  };
}

test("already-published plan contains no push and verifies the exact remote head", () => {
  withTemp((directory) => {
    const path = writeCheckpoint(directory, checkpointSnapshot());
    const plan = exactPlan(path);
    assert.deepEqual(plan.requests.map((entry) => entry.action), ["create_pr"]);
    const lock = lockCreatePrPublicationPlanCheckpoint({ path, plan });
    assert.equal(lock.mode, "already-published");
    assert.equal(lock.operationKeys.push_code, undefined);
    assert.equal(lock.headSha, HEAD);
    assert.equal(lock.verificationKey, createPrPublicationVerificationKey(lock));

    const create = plan.requests[0];
    assert.doesNotThrow(() => validateLifecycleMutation(create));
    const verification = verifyPublishedHead({ request: create, runner: runner() });
    assert.equal(verification.sha, HEAD);
    assert.equal(verification.observedSha, HEAD);
    assert.equal(verification.baseSha, BASE);
    assert.equal(verification.ancestry, "ahead");
    const preflight = preflightLifecycleMutation({ request: create, runner: runner() });
    assert.equal(preflight.publishedHead.observedSha, HEAD);
    assert.equal(preflight.state, "none");
  });
});

test("absent, moved, or non-descendant remote fails closed", () => {
  withTemp((directory) => {
    const path = writeCheckpoint(directory, checkpointSnapshot());
    const create = exactPlan(path).requests[0];
    assert.throws(
      () => verifyPublishedHead({ request: create, runner: runner({ branchSha: "absent" }) }),
      /published_head_branch_absent/,
    );
    assert.throws(
      () => verifyPublishedHead({ request: create, runner: runner({ branchSha: MOVED }) }),
      /published_head_mismatch/,
    );
    assert.throws(
      () => verifyPublishedHead({ request: create, runner: runner({ ancestry: "behind" }) }),
      /published_head_not_descendant/,
    );
    assert.throws(
      () => verifyPublishedHead({ request: create, runner: runner({ baseSha: "absent" }) }),
      /published_head_base_absent/,
    );
    assert.throws(
      () => verifyPublishedHead({
        request: create,
        runner: runner({ repoView: { url: "https://github.com/other/widgets", sshUrl: "" } }),
      }),
      /push_remote_repo_mismatch/,
    );
    assert.throws(
      () => verifyPublishedHead({
        request: create,
        runner: runner({ failRead: { command: "git", args: "ls-remote --heads origin refs/heads/feature/widgets", message: "read failed" } }),
      }),
      /read failed/,
    );
  });
});

test("already-published execution rejects push, wrong repo, wrong base, and stale head", () => {
  withTemp((directory) => {
    const path = writeCheckpoint(directory, checkpointSnapshot());
    const plan = exactPlan(path);
    lockCreatePrPublicationPlanCheckpoint({ path, plan });
    const create = plan.requests[0];
    assert.throws(
      () => mutationExecutionContextFromCheckpoint({ path, request: pushPlan(path).requests[0] }),
      /create_pr_publication_plan_mismatch/,
    );
    assert.throws(
      () => mutationExecutionContextFromCheckpoint({ path, request: { ...create, repo: "other/widgets" } }),
      /mutation_checkpoint_repo_mismatch/,
    );
    assert.throws(
      () => mutationExecutionContextFromCheckpoint({ path, request: { ...create, base: "develop" } }),
      /pre_open_evidence_scope_mismatch/,
    );
    assert.throws(
      () => mutationExecutionContextFromCheckpoint({ path, request: { ...create, publishedHead: { ...create.publishedHead, sha: MOVED } } }),
      /pre_open_evidence_scope_mismatch/,
    );
    assert.throws(
      () => mutationExecutionContextFromCheckpoint({ path, request: { ...create, title: "Different effect" } }),
      /create_pr_publication_plan_mismatch/,
    );

    const snapshot = readDeliveryWorkflowCheckpoint(path);
    snapshot.headSha = MOVED;
    writeDeliveryWorkflowCheckpoint(path, snapshot);
    assert.throws(
      () => mutationExecutionContextFromCheckpoint({ path, request: create }),
      /pre_open_hygiene_no_comments_stale/,
    );
  });
});

test("missing hygiene, pre-open evidence, or authority blocks exact-head publication", () => {
  withTemp((directory) => {
    const noHygiene = writeCheckpoint(directory, checkpointSnapshot({ hygiene: false, gate: false, forceOpen: true }));
    const plan = exactPlan(noHygiene);
    lockCreatePrPublicationPlanCheckpoint({ path: noHygiene, plan });
    assert.throws(
      () => mutationExecutionContextFromCheckpoint({ path: noHygiene, request: plan.requests[0] }),
      /pre_open_hygiene_no_comments_missing/,
    );
  });
  withTemp((directory) => {
    const noGate = writeCheckpoint(directory, checkpointSnapshot({ gate: false, forceOpen: true }));
    const plan = exactPlan(noGate);
    lockCreatePrPublicationPlanCheckpoint({ path: noGate, plan });
    assert.throws(
      () => mutationExecutionContextFromCheckpoint({ path: noGate, request: plan.requests[0] }),
      /pre_open_evidence_missing/,
    );
  });
  withTemp((directory) => {
    const path = writeCheckpoint(directory, checkpointSnapshot());
    const create = exactPlan(path).requests[0];
    assert.throws(
      () => planLifecycleMutationRequest({ ...create, mutationMode: "read-only", explicitInstruction: false }),
      /mutation_denied:mode_denied/,
    );
    assert.doesNotThrow(
      () => planLifecycleMutationRequest({ ...create, mutationMode: "maintainer", explicitInstruction: true }),
    );
  });
});

test("draft-only and exact-head duplicate prevention stay enforced", () => {
  withTemp((directory) => {
    const path = writeCheckpoint(directory, checkpointSnapshot());
    assert.throws(
      () => exactPlan(path, { draft: false }),
      /create_pr_publication_plan_draft_only/,
    );
    const plan = exactPlan(path);
    assert.throws(
      () => createPrPublicationPlanLock({
        ...plan,
        requests: [{ ...plan.requests[0], draft: false }],
      }, { headSha: HEAD }),
      /create_pr_publication_plan_draft_only/,
    );
    assert.throws(
      () => preflightLifecycleMutation({ request: plan.requests[0], runner: runner({ pulls: [duplicatePull()] }) }),
      /create_pr_existing:391/,
    );
  });
});

test("controller records a plan-bound verification receipt and completes publication", () => {
  withTemp((directory) => {
    const path = writeCheckpoint(directory, checkpointSnapshot());
    const plan = exactPlan(path);
    const lock = lockCreatePrPublicationPlanCheckpoint({ path, plan });
    const create = plan.requests[0];
    const verification = verifyPublishedHead({ request: create, runner: runner() });
    assert.deepEqual(
      mutationExecutionContextFromCheckpoint({ path, request: create }),
      { trustedWorkflowIntent: true, trustedExactTextConfirmation: false },
    );
    reconcileMutationCheckpoint({
      path,
      output: {
        action: "create_pr",
        request: create,
        status: "succeeded",
        operationKey: mutationOperationKey(create),
        verification: { number: 391, url: "https://github.com/acme/widgets/pull/391" },
        publishedHeadVerification: verification,
      },
    });
    const snapshot = readDeliveryWorkflowCheckpoint(path);
    assert.equal(snapshot.publicationReceipts.create_pr.status, "succeeded");
    assert.equal(snapshot.publicationReceipts.published_head.operationKey, lock.verificationKey);
    assert.equal(snapshot.publicationReceipts.published_head.verification.sha, HEAD);
    assert.doesNotThrow(() => assertCreatePrPublicationComplete(snapshot));
    const resumed = createDeliveryWorkflowController({ snapshot, graph: snapshot.graph });
    assert.equal(resumed.transition("REVIEW_FEEDBACK").phase, "REVIEW_FEEDBACK");
  });
});

test("forged or stale verification receipts never complete publication", () => {
  withTemp((directory) => {
    const path = writeCheckpoint(directory, checkpointSnapshot());
    const plan = exactPlan(path);
    lockCreatePrPublicationPlanCheckpoint({ path, plan });
    const create = plan.requests[0];
    const verification = verifyPublishedHead({ request: create, runner: runner() });
    reconcileMutationCheckpoint({
      path,
      output: {
        action: "create_pr",
        request: create,
        status: "succeeded",
        operationKey: mutationOperationKey(create),
        publishedHeadVerification: { ...verification, sha: MOVED, repo: "other/widgets" },
      },
    });
    let snapshot = readDeliveryWorkflowCheckpoint(path);
    assert.equal(snapshot.publicationReceipts.published_head, undefined);
    assert.throws(() => assertCreatePrPublicationComplete(snapshot), /create_pr_publication_incomplete/);

    snapshot.publicationReceipts.published_head = {
      action: "published_head",
      operationKey: `published-head:${"e".repeat(64)}`,
      status: "succeeded",
      recordedAt: 1,
      verification,
    };
    writeDeliveryWorkflowCheckpoint(path, snapshot);
    snapshot = readDeliveryWorkflowCheckpoint(path);
    assert.throws(() => assertCreatePrPublicationComplete(snapshot), /create_pr_publication_incomplete/);
  });
});

test("old push-mode publication lock and receipts keep working", () => {
  withTemp((directory) => {
    const path = writeCheckpoint(directory, checkpointSnapshot());
    const plan = pushPlan(path);
    const lock = lockCreatePrPublicationPlanCheckpoint({ path, plan });
    assert.equal(lock.mode, "push");
    assert.ok(lock.operationKeys.push_code);
    assert.doesNotThrow(
      () => mutationExecutionContextFromCheckpoint({ path, request: plan.requests[0] }),
    );
    reconcileMutationCheckpoint({
      path,
      output: {
        action: "push_code",
        request: plan.requests[0],
        status: "succeeded",
        operationKey: mutationOperationKey(plan.requests[0]),
      },
    });
    let snapshot = readDeliveryWorkflowCheckpoint(path);
    assert.equal(snapshot.publicationReceipts.push_code.status, "succeeded");
    assert.throws(() => assertCreatePrPublicationComplete(snapshot), /create_pr_publication_incomplete/);
    reconcileMutationCheckpoint({
      path,
      output: {
        action: "create_pr",
        request: plan.requests[1],
        status: "succeeded",
        operationKey: mutationOperationKey(plan.requests[1]),
        verification: { number: 391, url: "https://github.com/acme/widgets/pull/391" },
      },
    });
    snapshot = readDeliveryWorkflowCheckpoint(path);
    assert.doesNotThrow(() => assertCreatePrPublicationComplete(snapshot));
  });
});

test("existing push lock can be replanned explicitly to already-published", () => {
  withTemp((directory) => {
    const path = writeCheckpoint(directory, checkpointSnapshot());
    const old = pushPlan(path);
    lockCreatePrPublicationPlanCheckpoint({ path, plan: old });
    const nextPlan = exactPlan(path);
    const replanned = replanCreatePrPublicationPlanCheckpoint({
      path,
      plan: nextPlan,
      reason: "remote branch already contains the exact candidate",
      now: () => 1234,
    });
    assert.equal(replanned.mode, "already-published");
    assert.equal(replanned.headSha, HEAD);
    assert.equal(replanned.replannedFrom.mode, "push");
    assert.equal(replanned.replannedFrom.pushOperationKey, mutationOperationKey(old.requests[0]));
    assert.equal(replanned.replannedFrom.createPrOperationKey, mutationOperationKey(old.requests[1]));
    assert.equal(replanned.replannedFrom.reason, "remote branch already contains the exact candidate");
    assert.deepEqual(readDeliveryWorkflowCheckpoint(path).publicationReceipts, {});

    const again = replanCreatePrPublicationPlanCheckpoint({
      path,
      plan: nextPlan,
      reason: "repeat",
      now: () => 1234,
    });
    assert.equal(again.verificationKey, replanned.verificationKey);
  });
});

test("replan rejects missing reason, missing evidence, receipts, and changed effects", () => {
  withTemp((directory) => {
    const noGatePath = writeCheckpoint(directory, checkpointSnapshot({ gate: false, forceOpen: true }));
    lockCreatePrPublicationPlanCheckpoint({ path: noGatePath, plan: pushPlan(noGatePath) });
    assert.throws(
      () => replanCreatePrPublicationPlanCheckpoint({
        path: noGatePath,
        plan: exactPlan(noGatePath),
        reason: "remote exact",
      }),
      /create_pr_publication_replan_evidence_missing/,
    );
  });
  withTemp((directory) => {
    const path = writeCheckpoint(directory, checkpointSnapshot());
    const old = pushPlan(path);
    lockCreatePrPublicationPlanCheckpoint({ path, plan: old });
    assert.throws(
      () => replanCreatePrPublicationPlanCheckpoint({ path, plan: exactPlan(path), reason: "" }),
      /create_pr_publication_replan_reason_required/,
    );
    assert.throws(
      () => replanCreatePrPublicationPlanCheckpoint({ path, plan: pushPlan(path), reason: "same mode" }),
      /create_pr_publication_replan_mode_invalid/,
    );
    reconcileMutationCheckpoint({
      path,
      output: {
        action: "push_code",
        request: old.requests[0],
        status: "succeeded",
        operationKey: mutationOperationKey(old.requests[0]),
      },
    });
    assert.throws(
      () => replanCreatePrPublicationPlanCheckpoint({ path, plan: exactPlan(path), reason: "after push" }),
      /create_pr_publication_replan_receipts_present/,
    );
  });
});

test("planner CLI applies the explicit replan transition", () => {
  withTemp((directory) => {
    const path = writeCheckpoint(directory, checkpointSnapshot());
    lockCreatePrPublicationPlanCheckpoint({ path, plan: pushPlan(path) });
    const input = join(directory, "plan.json");
    writeFileSync(input, JSON.stringify({
      publicationMode: "already-published",
      repo: REPO,
      remote: "origin",
      branch: BRANCH,
      base: BASE_REF,
      publishedSha: HEAD,
      title: "Fix widgets",
      body: "Body",
      idempotencyKey: "create-pr-feature-widgets",
      checkpoint: path,
    }), "utf8");
    const result = spawnSync(
      process.execPath,
      [PLANNER, "--input", input, "--replan", "--reason", "remote exact"],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const snapshot = readDeliveryWorkflowCheckpoint(path);
    assert.equal(snapshot.publicationPlan.mode, "already-published");
    assert.equal(snapshot.publicationPlan.replannedFrom.reason, "remote exact");
  });
});

test("already-published lock rejects different effects through the same replan path", () => {
  withTemp((directory) => {
    const path = writeCheckpoint(directory, checkpointSnapshot());
    const old = pushPlan(path);
    lockCreatePrPublicationPlanCheckpoint({ path, plan: old });
    replanCreatePrPublicationPlanCheckpoint({
      path,
      plan: exactPlan(path),
      reason: "remote exact",
    });
    assert.throws(
      () => replanCreatePrPublicationPlanCheckpoint({
        path,
        plan: exactPlan(path, { title: "Different effect" }),
        reason: "different",
      }),
      /create_pr_publication_plan_already_locked/,
    );
    assert.throws(
      () => lockCreatePrPublicationPlanCheckpoint({
        path,
        plan: exactPlan(path, { title: "Different effect" }),
      }),
      /create_pr_publication_plan_already_locked/,
    );
  });
});

