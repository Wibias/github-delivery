import assert from "node:assert/strict";
import test from "node:test";

import {
  makeGitHubBodyTransportRunner,
  transportGitHubBody,
} from "../../scripts/lib/github-body-transport.mjs";

const LARGE_BODY = "x".repeat(40_000);

test("large gh --body values move to stdin instead of the process command line", () => {
  const result = transportGitHubBody(
    "gh",
    ["pr", "comment", "42", "--repo", "acme/widgets", "--body", LARGE_BODY],
    { encoding: "utf8" },
  );

  assert.deepEqual(result.args, [
    "pr",
    "comment",
    "42",
    "--repo",
    "acme/widgets",
    "--body-file",
    "-",
  ]);
  assert.equal(result.options.input, LARGE_BODY);
  assert.equal(result.kind, "body_file_stdin");
  assert.ok(result.args.join(" ").length < 1_000);
});

test("large gh api body fields move to JSON stdin", () => {
  const result = transportGitHubBody(
    "gh",
    [
      "api",
      "repos/acme/widgets/issues/comments/123",
      "--method",
      "PATCH",
      "-f",
      `body=${LARGE_BODY}`,
    ],
    { encoding: "utf8" },
  );

  assert.deepEqual(result.args, [
    "api",
    "repos/acme/widgets/issues/comments/123",
    "--method",
    "PATCH",
    "--input",
    "-",
  ]);
  assert.deepEqual(JSON.parse(result.options.input), { body: LARGE_BODY });
  assert.equal(result.kind, "api_json_stdin");
  assert.ok(result.args.join(" ").length < 1_000);
});

test("body transport runner preserves ordinary commands and delivers stdin exactly", () => {
  const calls = [];
  const runner = makeGitHubBodyTransportRunner((command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0, stdout: "ok", stderr: "" };
  });

  runner(
    "gh",
    ["issue", "create", "--repo", "acme/widgets", "--title", "Large", "--body", LARGE_BODY],
    { encoding: "utf8" },
  );
  runner("git", ["status", "--short"], { encoding: "utf8" });

  assert.equal(calls[0].options.input, LARGE_BODY);
  assert.ok(!calls[0].args.includes(LARGE_BODY));
  assert.deepEqual(calls[1].args, ["status", "--short"]);
  assert.equal(calls[1].options.input, undefined);
});

test("API body fields with siblings fold into JSON stdin", () => {
  const result = transportGitHubBody(
    "gh",
    ["api", "repos/acme/widgets/x", "-f", `body=${LARGE_BODY}`, "-f", "other=value"],
    {},
  );
  assert.deepEqual(result.args, ["api", "repos/acme/widgets/x", "--input", "-"]);
  assert.deepEqual(JSON.parse(result.options.input), { body: LARGE_BODY, other: "value" });
  assert.equal(result.kind, "api_json_stdin");
});

test("typed field at-file body values still fail closed", () => {
  assert.throws(
    () => transportGitHubBody(
      "gh",
      ["api", "repos/acme/widgets/x", "-F", "body=@secret.txt"],
      {},
    ),
    /github_body_transport_field_at_file/,
  );
});
