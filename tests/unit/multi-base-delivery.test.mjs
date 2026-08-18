import assert from "node:assert/strict";
import test from "node:test";

import {
  planMultiBaseDelivery,
  portProvenanceMarker,
  summarizeMultiBaseDelivery,
  verifyPortPullRequest,
} from "../../scripts/lib/multi-base-delivery.mjs";

const HEAD = "a".repeat(40);

function plan(overrides = {}) {
  return planMultiBaseDelivery({
    repository: "acme/widgets",
    sourcePr: 42,
    sourceHeadSha: HEAD,
    sourceBase: "main",
    targetBases: ["release/1.x", "release/2.x"],
    ...overrides,
  });
}

test("plans one independent port per target base", () => {
  const result = plan();
  assert.deepEqual(result.ports.map((port) => port.targetBase), ["release/1.x", "release/2.x"]);
  assert.ok(result.ports.every((port) => port.topology === "parallel-port"));
  assert.notEqual(result.ports[0].branch, result.ports[1].branch);
});

test("different target refs remain branch-distinct even when their readable slugs collide", () => {
  const result = plan({ targetBases: ["release/1.x", "release-1.x"] });
  assert.notEqual(result.ports[0].branch, result.ports[1].branch);
  assert.match(result.ports[0].branch, /^github-delivery\/port-42-to-release-1\.x-[0-9a-f]{10}$/);
  assert.match(result.ports[1].branch, /^github-delivery\/port-42-to-release-1\.x-[0-9a-f]{10}$/);
});

test("all targets are required by default, but optional targets can be declared", () => {
  assert.ok(plan().ports.every((port) => port.required));
  const result = plan({ requiredBases: ["release/1.x"] });
  assert.equal(result.ports.find((port) => port.targetBase === "release/1.x").required, true);
  assert.equal(result.ports.find((port) => port.targetBase === "release/2.x").required, false);
});

test("source base cannot be targeted as a port", () => {
  assert.throws(() => plan({ targetBases: ["main"] }), /target_base_matches_source/);
});

test("invalid git-style target refs fail closed", () => {
  for (const target of ["release//1.x", "release/../main", "release/.hidden", "release/build.lock", "release/bad~name", "-release", "@"]) {
    assert.throws(() => plan({ targetBases: [target] }), /target_base_invalid/);
  }
});

test("required bases must be part of the target set", () => {
  assert.throws(() => plan({ requiredBases: ["release/3.x"] }), /required_base_not_targeted/);
});

test("provenance marker is stable and bound to source head and target base", () => {
  const one = portProvenanceMarker({ repository: "acme/widgets", sourcePr: 42, sourceHeadSha: HEAD, targetBase: "release/1.x" });
  const two = portProvenanceMarker({ repository: "acme/widgets", sourcePr: 42, sourceHeadSha: HEAD, targetBase: "release/2.x" });
  const stale = portProvenanceMarker({ repository: "acme/widgets", sourcePr: 42, sourceHeadSha: "b".repeat(40), targetBase: "release/1.x" });
  assert.notEqual(one, two);
  assert.notEqual(one, stale);
  assert.equal(one, portProvenanceMarker({ repository: "acme/widgets", sourcePr: 42, sourceHeadSha: HEAD, targetBase: "release/1.x" }));
});

test("port verification requires exact target base and provenance", () => {
  const port = plan().ports[0];
  assert.equal(verifyPortPullRequest(port, { number: 50, base: port.targetBase, body: port.provenanceMarker }).state, "verified");
  assert.equal(verifyPortPullRequest(port, { number: 50, base: "release/9.x", body: port.provenanceMarker }).state, "mismatch");
  assert.equal(verifyPortPullRequest(port, { number: 50, base: port.targetBase, body: "no marker" }).state, "mismatch");
});

test("wrong-base provenance is surfaced as invalid instead of disappearing as missing", () => {
  const delivery = plan({ targetBases: ["release/1.x"] });
  const port = delivery.ports[0];
  const result = summarizeMultiBaseDelivery({
    plan: delivery,
    observedPullRequests: [
      { number: 50, base: "release/9.x", body: port.provenanceMarker, merged: false },
    ],
  });

  assert.equal(result.state, "invalid");
  assert.deepEqual(result.requiredIncomplete, ["release/1.x"]);
  assert.deepEqual(result.invalid, [{
    number: 50,
    reason: "port_base_mismatch:release/9.x",
    expectedTargetBase: "release/1.x",
    observedTargetBase: "release/9.x",
  }]);
});

test("one PR carrying multiple port markers is invalid evidence", () => {
  const delivery = plan();
  const result = summarizeMultiBaseDelivery({
    plan: delivery,
    observedPullRequests: [{
      number: 50,
      base: "release/1.x",
      body: delivery.ports.map((port) => port.provenanceMarker).join("\n"),
      merged: false,
    }],
  });

  assert.equal(result.state, "invalid");
  assert.deepEqual(result.invalid[0], {
    number: 50,
    reason: "port_provenance_ambiguous",
    targetBases: ["release/1.x", "release/2.x"],
  });
});

test("required ports keep delivery incomplete until each one is merged", () => {
  const delivery = plan();
  const first = delivery.ports[0];
  const second = delivery.ports[1];

  const incomplete = summarizeMultiBaseDelivery({
    plan: delivery,
    observedPullRequests: [
      { number: 50, base: first.targetBase, body: first.provenanceMarker, merged: true },
      { number: 51, base: second.targetBase, body: second.provenanceMarker, merged: false },
    ],
  });
  assert.equal(incomplete.state, "incomplete");
  assert.deepEqual(incomplete.invalid, []);
  assert.deepEqual(incomplete.requiredIncomplete, ["release/2.x"]);

  const complete = summarizeMultiBaseDelivery({
    plan: delivery,
    observedPullRequests: [
      { number: 50, base: first.targetBase, body: first.provenanceMarker, merged: true },
      { number: 51, base: second.targetBase, body: second.provenanceMarker, merged: true },
    ],
  });
  assert.equal(complete.state, "complete");
  assert.deepEqual(complete.invalid, []);
});

test("duplicate port PRs for one target fail closed", () => {
  const delivery = plan({ targetBases: ["release/1.x"] });
  const port = delivery.ports[0];
  assert.throws(() => summarizeMultiBaseDelivery({
    plan: delivery,
    observedPullRequests: [
      { number: 50, base: port.targetBase, body: port.provenanceMarker, merged: false },
      { number: 51, base: port.targetBase, body: port.provenanceMarker, merged: false },
    ],
  }), /duplicate_port_pr/);
});
