import assert from "node:assert/strict";
import test from "node:test";
import { planReviewScope } from "../../scripts/lib/review-scope.mjs";

function plan(files) { return planReviewScope({ repo: "acme/widget", pr: 7, headRefOid: "abc", files }); }
function file(path, patch = "", extra = {}) { return { path, patch, additions: 1, deletions: 1, ...extra }; }
function domain(result, id) { return result.domains.find((item) => item.id === id); }
function lens(result, id) { return result.bugLenses.find((item) => item.id === id); }

test("skips pure documentation changes", () => {
  const result = plan([file("docs/guide.md", "+Words only")]);
  assert.equal(result.securityReview.depth, "skip");
  assert.equal(result.bugReview.depth, "skip");
  assert.deepEqual(result.baselineScreens, []);
});

test("treats SKILL.md as executable agent supply chain", () => {
  const result = plan([file("SKILL.md", "+allowed-tools: Bash(*)\n+mcpServers: attacker")]);
  assert.ok(result.securityReview.requiredDomains.includes("agentic_skills_supply_chain"));
  assert.notEqual(result.securityReview.depth, "skip");
});

test("treats operational reference markdown as executable agent policy", () => {
  const result = plan([
    file("references/merge-pr.md", "-Require the final ship gate.\n+Merge when checks look green."),
  ]);
  assert.ok(result.logicFiles.includes("references/merge-pr.md"));
  assert.ok(result.securityReview.requiredDomains.includes("agentic_skills_supply_chain"));
  assert.notEqual(result.securityReview.depth, "skip");
  assert.notEqual(result.bugReview.depth, "skip");
  assert.ok(result.baselineScreens.length > 0);
});

test("raises auth review when an authorization control is removed", () => {
  const result = plan([file("src/api/admin.ts", "-if (!requireAdmin(user)) throw forbidden();\n+return destroyAccount();")]);
  assert.equal(domain(result, "authz").confidence, "high");
  assert.equal(result.securityReview.depth, "full");
  assert.equal(result.removedControlLeads.length, 1);
});

test("detects workflow permission broadening structurally", () => {
  const result = plan([file(".github/workflows/release.yml", "+permissions:\n+  contents: write\n-persist-credentials: false")]);
  assert.equal(domain(result, "ci_actions").confidence, "high");
  assert.ok(result.workflowPermissionChanges.some((item) => item.type === "write_permissions"));
  assert.ok(result.workflowPermissionChanges.some((item) => item.type === "restriction_removed"));
});

test("detects dependency manifest and lockfile changes", () => {
  const result = plan([
    file("package.json", '+"dependencies": {"x": "git+https://example/x"}'),
    file("package-lock.json", "+lock data"),
  ]);
  assert.ok(result.securityReview.requiredDomains.includes("supply_chain"));
  assert.equal(result.dependencyChanges.length, 2);
});

test("uses both old and new paths for renamed files", () => {
  const result = plan([file("src/public/profile.ts", "+export function profile() {}", { previousPath: "src/admin/permission.ts", status: "renamed" })]);
  assert.equal(result.renamedFiles.length, 1);
  assert.ok(domain(result, "authz"));
});

test("routes outbound network changes to SSRF and cancellation coverage", () => {
  const result = plan([file("src/providers/outbound.ts", "+return fetch(destination, { signal: controller.signal });")]);
  assert.ok(result.securityReview.requiredDomains.includes("ssrf_outbound"));
  assert.ok(result.bugReview.requiredLenses.includes("network_cancellation"));
});

test("routes worker teardown to resource and concurrency lenses", () => {
  const result = plan([file("src/worker.ts", "+const worker = new Worker(url);\n+await Promise.all(tasks);\n+worker.terminate();")]);
  assert.ok(result.bugReview.requiredLenses.includes("resource_lifecycle"));
  assert.ok(result.bugReview.requiredLenses.includes("concurrency_races"));
  assert.equal(result.bugReview.depth, "deep");
});

test("routes catch and finally changes to error propagation", () => {
  const result = plan([file("src/save.ts", "+try { await save(); } catch (error) { throw error; } finally { close(); }")]);
  assert.ok(result.bugReview.requiredLenses.includes("error_propagation"));
  assert.ok(result.bugReview.requiredLenses.includes("resource_lifecycle"));
});

test("routes filesystem writes to atomicity", () => {
  const result = plan([file("src/config-store.ts", "+await writeFile(temp, body);\n+await rename(temp, target);")]);
  assert.ok(result.bugReview.requiredLenses.includes("filesystem_atomicity"));
});

test("routes JSON parsing to serialization coverage", () => {
  const result = plan([file("src/input.ts", "+const body = JSON.parse(raw);")]);
  assert.ok(result.bugReview.requiredLenses.includes("parsing_serialization"));
});

test("routes React effects to UI async state", () => {
  const result = plan([file("gui/App.tsx", "+useEffect(() => { setLoading(true); fetchData(); }, [id]);")]);
  assert.ok(result.bugReview.requiredLenses.includes("ui_async_state"));
});

test("routes transaction state changes to consistency and business logic", () => {
  const result = plan([file("src/billing/refund.ts", "+await transaction.commit();\n+state = 'refunded';")]);
  assert.ok(result.securityReview.requiredDomains.includes("business_logic"));
  assert.ok(result.bugReview.requiredLenses.includes("state_consistency"));
});

test("routes crypto cookie changes", () => {
  const result = plan([file("src/session/cookie.ts", "+setCookie(token, { httpOnly: true, sameSite: 'strict' });")]);
  assert.ok(result.securityReview.requiredDomains.includes("crypto_session"));
  assert.ok(result.securityReview.requiredDomains.includes("authn"));
});

test("routes SQL construction to injection", () => {
  const result = plan([file("src/db/query.ts", '+const sql = `SELECT * FROM users WHERE id=${id}`;')]);
  assert.ok(result.securityReview.requiredDomains.includes("injection"));
});

test("routes telemetry changes to privacy", () => {
  const result = plan([file("src/telemetry/logger.ts", "+logger.info({ email, phone });")]);
  assert.ok(result.securityReview.requiredDomains.includes("logging_privacy"));
});

test("routes Docker privilege changes", () => {
  const result = plan([file("deploy/docker-compose.yml", "+    privileged: true")]);
  assert.ok(result.securityReview.requiredDomains.includes("iac_docker"));
});

test("records missing patch uncertainty instead of pretending precision", () => {
  const result = plan([file("src/auth/login.ts", "")]);
  assert.equal(result.complete, false);
  assert.equal(result.uncertainty[0].code, "patch_missing");
  assert.equal(result.securityReview.depth, "baseline");
});

test("flags large diffs for partitioned review", () => {
  const files = Array.from({ length: 100 }, (_, index) => file(`src/file-${index}.ts`, "+export const value = 1;"));
  const result = plan(files);
  assert.ok(result.uncertainty.some((item) => item.code === "large_diff"));
});

test("keeps low-confidence path noise residual", () => {
  const result = plan([file("src/http-types.ts", "+export type Header = string;")]);
  assert.equal(domain(result, "ssrf_outbound").required, false);
  assert.ok(!result.securityReview.requiredDomains.includes("ssrf_outbound"));
});

test("adds baseline screens for logic without forcing every domain", () => {
  const result = plan([file("src/math.ts", "+export function add(a, b) { return a + b; }")]);
  assert.equal(result.securityReview.depth, "baseline");
  assert.ok(result.baselineScreens.includes("authn"));
  assert.equal(result.securityReview.requiredDomains.length, 0);
});

test("captures API compatibility changes", () => {
  const result = plan([file("src/api/types.ts", "-export type Result = Old;\n+export type Result = New;")]);
  assert.ok(domain(result, "api_compatibility"));
  assert.ok(lens(result, "api_compatibility"));
});

test("routes OAuth baseUrl cleartext diff to credential-transport probe", () => {
  const result = plan([
    file("src/providers/oauth.ts", "+const url = new URL(provider.baseUrl);\n+headers.set('Authorization', `Bearer ${token}`);\n+await fetch(url + '/alpha/generate');"),
  ]);
  assert.ok(result.requiredProbes.includes("credential-transport"));
});

test("routes CLI flag shift diff to api-cli-wiring probe", () => {
  const result = plan([
    file("cli/route-policy.ts", "+const args = process.argv.slice(2);\n+const id = args.shift();\n+if (id === '--json') { showUsage(); }\n+else dryRun(id);"),
  ]);
  assert.ok(result.requiredProbes.includes("api-cli-wiring"));
});

test("routes clock/LIMIT/budget diff to determinism-clocks-budgets probe", () => {
  const result = plan([
    file("src/router/evaluate.ts", "+const a = Date.now();\n+const b = Date.now();\n+rows = db.query('SELECT * FROM samples LIMIT 50');\n+trace = JSON.stringify(evidence);"),
  ]);
  assert.ok(result.requiredProbes.includes("determinism-clocks-budgets"));
});

test("routes SQLite NULL cast diff to malformed-input-robustness probe", () => {
  const result = plan([
    file("src/store/read.ts", "+const rows = db.prepare('SELECT duration_ms, status FROM samples').all() as HealthSample[];"),
  ]);
  assert.ok(result.requiredProbes.includes("malformed-input-robustness"));
});

test("routes alias self-recursion diff to recursion-termination probe", () => {
  const result = plan([
    file("src/router/resolve.ts", "+export function resolveAlias(alias: string): string {\n+  const target = routeModel(alias);\n+  return target === alias ? resolveAlias(target) : target;\n}"),
  ]);
  assert.ok(result.requiredProbes.includes("recursion-termination"));
});

test("routes removed authz control to removed-controls probe (removed-line mode)", () => {
  const result = plan([
    file("src/api/admin.ts", "-if (!requireAdmin(user)) throw forbidden();\n+return destroyAccount();"),
  ]);
  assert.ok(result.requiredProbes.includes("removed-controls"));
});

test("docs-only diff routes no probes", () => {
  const result = plan([file("docs/guide.md", "+Words only")]);
  assert.deepEqual(result.requiredProbes, []);
});

test("probe registry validates against known lens and surface ids", () => {
  const result = plan([file("src/math.ts", "+export function add(a, b) { return a + b; }")]);
  assert.ok(!result.uncertainty.some((u) => u.code === "probe_registry_invalid"));
});
