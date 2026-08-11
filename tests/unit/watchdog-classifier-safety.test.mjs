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

test("read-looking shell commands with output writes are not treated as pure evidence", () => {
  assert.equal(classify("cat README.md > README.copy.md").kind, "neutral");
  assert.equal(classify("Get-Content README.md | Set-Content README.copy.md").kind, "neutral");
});
