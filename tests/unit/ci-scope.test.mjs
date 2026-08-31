import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyCiScope,
  formatScopeOutput,
  parseNullDelimitedPaths,
  runCiScope,
} from "../../scripts/ci-scope.mjs";

test("NUL-delimited path parsing preserves control characters instead of Git quoting", () => {
  const paths = parseNullDelimitedPaths(
    Buffer.from("authority-host/windows/evil\nname.cs\0tests/tab\tname.mjs\0", "utf8"),
  );
  assert.deepEqual(paths, [
    "authority-host/windows/evil\nname.cs",
    "tests/tab\tname.mjs",
  ]);
});

test("NUL-delimited path parsing rejects a truncated filename stream", () => {
  assert.throws(
    () => parseNullDelimitedPaths(Buffer.from("authority-host/windows/file.cs", "utf8")),
    /ci_scope_input_not_nul_terminated/,
  );
});

test("Windows and C# scope cannot be hidden with unusual valid Git path characters", () => {
  for (const path of [
    "authority-host/windows/evil\nname.cs",
    "authority-host/windows/evil\tname.cs",
    'authority-host/windows/evil"name.cs',
    "authority-host/windows/evil\\name.cs",
    "authority-host/windows/ümlaut.cs",
    "authority-host/windows/-leading-dash.cs",
  ]) {
    const scope = classifyCiScope([path]);
    assert.equal(scope.windowsAuthority, true, path);
    assert.equal(scope.csharp, true, path);
  }
});

test("ordinary unrelated paths remain outside scoped compatibility lanes", () => {
  assert.deepEqual(classifyCiScope(["docs/readme.md", "README.md"]), {
    nodeCompat: false,
    windowsAuthority: false,
    csharp: false,
    javascript: false,
  });
});

test("non-documentation paths keep JavaScript CodeQL in scope", () => {
  assert.equal(classifyCiScope(["scripts/lib/skill-router.mjs"]).javascript, true);
  assert.equal(classifyCiScope(["authority-host/windows/service.cs"]).javascript, true);
});

test("CI and C# output stays explicit and machine-readable", () => {
  const scope = classifyCiScope(["authority-host/windows/service.cs", "tests/a.test.mjs"]);
  assert.equal(
    formatScopeOutput("ci", scope),
    "node_compat=true\nwindows_authority=true",
  );
  assert.equal(formatScopeOutput("csharp", scope), "required=true");
  assert.equal(
    formatScopeOutput("codeql", scope),
    "javascript=true\ncsharp=true",
  );
});

test("CLI contract consumes only a complete NUL-delimited stream", () => {
  assert.equal(
    runCiScope({ mode: "ci", input: Buffer.from("docs/a.md\0", "utf8") }),
    "node_compat=false\nwindows_authority=false",
  );
  assert.equal(
    runCiScope({ mode: "codeql", input: Buffer.from("docs/a.md\0README.md\0", "utf8") }),
    "javascript=false\ncsharp=false",
  );
  assert.throws(
    () => runCiScope({ mode: "ci", input: Buffer.from("docs/a.md", "utf8") }),
    /ci_scope_input_not_nul_terminated/,
  );
});
