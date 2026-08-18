import assert from "node:assert/strict";
import test from "node:test";

import { planVisualEvidence, validateVisualEvidence } from "../../scripts/lib/visual-evidence.mjs";

const HEAD = "a".repeat(40);

test("requires visual evidence for stylesheet changes", () => {
  const plan = planVisualEvidence([{ path: "src/styles/app.css", patch: "+.card { display: grid; }" }]);
  assert.equal(plan.required, true);
  assert.equal(plan.confidence, "high");
  assert.deepEqual(plan.files, ["src/styles/app.css"]);
});

test("requires visual evidence for UI markup changes but not arbitrary TypeScript", () => {
  const ui = planVisualEvidence([{ path: "src/components/Card.tsx", patch: "+return <button className=\"primary\">Go</button>;" }]);
  const backend = planVisualEvidence([{ path: "src/server/token.ts", patch: "+return token.length;" }]);
  assert.equal(ui.required, true);
  assert.equal(backend.required, false);
});

test("documentation images do not force product visual evidence", () => {
  const plan = planVisualEvidence([{ path: "docs/example.png", status: "modified" }]);
  assert.equal(plan.required, false);
});

test("visual assets renamed between docs and product paths still protect the product-side change", () => {
  const intoProduct = planVisualEvidence([{
    path: "src/assets/example.png",
    previousPath: "docs/example.png",
    status: "renamed",
  }]);
  assert.equal(intoProduct.required, true);
  assert.deepEqual(intoProduct.files, ["src/assets/example.png"]);

  const outOfProduct = planVisualEvidence([{
    path: "docs/example.png",
    previousPath: "src/assets/example.png",
    status: "renamed",
  }]);
  assert.equal(outOfProduct.required, true);
  assert.deepEqual(outOfProduct.files, ["docs/example.png"]);
});

test("visual evidence must be bound to the current head", () => {
  const plan = planVisualEvidence([{ path: "src/styles/app.css", patch: "+color: red;" }]);
  const stale = validateVisualEvidence({
    plan,
    headRefOid: HEAD,
    artifacts: [{ kind: "screenshot", headRefOid: "b".repeat(40), path: "shot.png" }],
  });
  assert.equal(stale.state, "missing");
  assert.equal(stale.complete, false);

  const fresh = validateVisualEvidence({
    plan,
    headRefOid: HEAD,
    artifacts: [{ kind: "screenshot", headRefOid: HEAD, path: "shot.png" }],
  });
  assert.equal(fresh.state, "satisfied");
  assert.equal(fresh.complete, true);
});

test("an honest runtime blocker remains blocked, never satisfied", () => {
  const plan = planVisualEvidence([{ path: "src/styles/app.css", patch: "+color: red;" }]);
  const result = validateVisualEvidence({
    plan,
    headRefOid: HEAD,
    blocker: { state: "blocked", reason: "preview cannot start without required service" },
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.complete, false);
});

test("non-visual changes need no artifact", () => {
  const plan = planVisualEvidence([{ path: "src/server/token.ts", patch: "+return token.length;" }]);
  assert.deepEqual(validateVisualEvidence({ plan }), { state: "not_required", complete: true, artifacts: [] });
});
