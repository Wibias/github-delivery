import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const canonicalizerPath = new URL(
  "../../authority-host/windows/GitHubDeliveryAuthority/ScopeCanonicalizer.cs",
  import.meta.url,
);

test("Windows authority scope binds only non-empty approved PR media removals as a canonical set", async () => {
  const source = await readFile(canonicalizerPath, "utf8");
  const updateCase = source.match(/case "update_pr_body":[\s\S]*?break;/)?.[0] || "";

  assert.match(updateCase, /approvedMediaRemovals/);
  assert.match(updateCase, /CanonicalStringSet\(request, "approvedMediaRemovals", optional: true\)/);
  assert.match(updateCase, /if \(approvedMediaRemovals\.Count > 0\) scope\["approvedMediaRemovals"\] = approvedMediaRemovals;/);
  assert.match(source, /Distinct\(StringComparer\.Ordinal\)/);
  assert.match(source, /OrderBy\(value => value, StringComparer\.Ordinal\)/);
});

test("Windows create PR scope binds optional exact head repository identity", async () => {
  const source = await readFile(canonicalizerPath, "utf8");
  const createCase = source.match(/case "create_pr":[\s\S]*?break;/)?.[0] || "";

  assert.match(createCase, /OptionalString\(request, "headRepo"\)/);
  assert.match(createCase, /scope\["headRepo"\] = headRepo/);
});
