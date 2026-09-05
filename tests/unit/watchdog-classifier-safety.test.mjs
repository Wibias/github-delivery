import assert from "node:assert/strict";
import test from "node:test";

import { classifyHookTool } from "../../scripts/lib/watchdog-progress-classifier.mjs";

function classify(command) {
  return classifyHookTool({ tool_name: "Bash", tool_input: { command } });
}

test("plain and explicit-GET gh api calls are evidence", () => {
  assert.equal(classify("gh api repos/o/r/pulls/42").kind, "evidence");
  assert.equal(
    classify("gh api repos/o/r/issues --method GET -f per_page=100").kind,
    "evidence",
  );
});

test("mutating REST gh api calls are state changes", () => {
  assert.equal(
    classify("gh api repos/o/r/issues/42 --method PATCH -f state=closed").kind,
    "state-change",
  );
  assert.equal(
    classify("gh api repos/o/r/issues -f title='watchdog regression'").kind,
    "state-change",
  );
  assert.equal(
    classify("gh api repos/o/r/issues/42 -X DELETE").kind,
    "state-change",
  );
});

test("GraphQL reads remain evidence while literal mutations are state changes", () => {
  assert.equal(
    classify("gh api graphql -f query='query { viewer { login } }'").kind,
    "evidence",
  );
  assert.equal(
    classify("gh api graphql -f query='mutation { addStar(input:{starrableId:\"x\"}) { clientMutationId } }'").kind,
    "state-change",
  );
});

test("opaque GraphQL input files stay neutral instead of falsely resetting progress", () => {
  assert.equal(classify("gh api graphql --input request.json").kind, "neutral");
});

test("mixed read/write tool names stay neutral instead of falsely resetting progress", () => {
  assert.equal(
    classifyHookTool({
      tool_name: "mcp__provider__get_update_status",
      tool_input: {},
    }).kind,
    "neutral",
  );
  assert.equal(
    classifyHookTool({
      tool_name: "mcp__provider__update_issue_status",
      tool_input: {},
    }).kind,
    "neutral",
  );
});

test("read-looking shell redirection stays neutral while explicit write cmdlets are state changes", () => {
  assert.equal(classify("cat README.md > README.copy.md").kind, "neutral");
  assert.equal(
    classify("Get-Content README.md | Set-Content README.copy.md").kind,
    "state-change",
  );
  assert.equal(classify("Set-Content README.copy.md 'x'").kind, "state-change");
});

test("Windows PowerShell read forms from real incidents are evidence", () => {
  const commands = [
    "Get-ChildItem -LiteralPath 'D:\\repo\\src' -Recurse",
    "(Get-Content -LiteralPath 'D:\\repo\\src\\core.ts' | Select-Object -First 40)",
    "Write-Output 'status'; git -C 'D:\\repo' status --short",
    "git -C 'D:\\repo' diff -- src/core.ts",
    "git -C 'D:\\repo' log -5 --oneline",
  ];
  for (const command of commands) {
    assert.equal(classify(command).kind, "evidence", command);
  }
});

test("GitHub Delivery owned evidence helpers are classified explicitly", () => {
  const evidenceHelpers = [
    "node scripts/ci-forensics.mjs o/r 42",
    "node scripts/runtime-capabilities.mjs --repo o/r",
    "node scripts/review-brief.mjs o/r 42 --json",
    "node scripts/ship-gate.mjs o/r 42 --json",
  ];
  for (const command of evidenceHelpers) {
    assert.equal(classify(command).kind, "evidence", command);
  }
});

test("Bun validation commands count as execution progress while dev does not", () => {
  const executionCommands = [
    "bun test",
    "bun test tests/unit/watchdog-classifier-safety.test.mjs",
    "bun run test",
    "bun run check",
    "bun run lint",
    "bun run lint:gui",
    "bun run build",
    "bun run build:gui",
    "bun run typecheck",
    "bun run verify",
  ];

  for (const command of executionCommands) {
    assert.equal(classify(command).kind, "execution", command);
  }

  assert.equal(classify("bun run dev").kind, "neutral");
});

test("PowerShell assignment-prefixed reads from real incidents are evidence", () => {
  const commands = [
    "$c=Get-Content -LiteralPath 'C:\\repo\\src\\component.ts'; $c[430..565]",
    "$c = Get-Content -LiteralPath 'C:\\repo\\src\\component.ts'; $c[65..95]",
    "$lines=Get-Content 'C:\\repo\\tests\\component.test.ts'; $lines[1..70]",
  ];

  for (const command of commands) {
    assert.equal(classify(command).kind, "evidence", command);
  }
});

test("direct Node script execution counts as execution progress", () => {
  assert.equal(
    classify("node collect-ft10-evidence.mjs --rows=33").kind,
    "execution",
  );
  assert.equal(
    classify("node scripts/check-contract.mjs --fixture candidate.json").kind,
    "execution",
  );
});

test("explicit Node module eval harnesses count as execution progress", () => {
  assert.equal(
    classify(
      "node --input-type=module -e \"import('./src/contract.mjs').then(() => process.exit(0))\"",
    ).kind,
    "execution",
  );
  assert.equal(
    classify(
      "node.exe --input-type=module --eval \"import('./src/contract.mjs')\"",
    ).kind,
    "execution",
  );
});

test("generic inline Node snippets remain neutral instead of manufacturing execution progress", () => {
  assert.equal(classify("node -e \"console.log('noop')\"").kind, "neutral");
  assert.equal(classify("node --eval \"process.exit(0)\"").kind, "neutral");
  assert.equal(classify("node -p \"1 + 1\"").kind, "neutral");
  assert.equal(classify("node --print \"1 + 1\"").kind, "neutral");
});
