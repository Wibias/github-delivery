import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const project = readFileSync(
  new URL("../../authority-host/windows/GitHubDeliveryAuthority/GitHubDeliveryAuthority.csproj", import.meta.url),
  "utf8",
);

test("self-contained Windows authority host pins a patched .NET 8 runtime", () => {
  assert.match(project, /<RuntimeFrameworkVersion>8\.0\.33<\/RuntimeFrameworkVersion>/);
});
