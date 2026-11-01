import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const project = readFileSync(
  new URL("../../authority-host/windows/GitHubDeliveryAuthority/GitHubDeliveryAuthority.csproj", import.meta.url),
  "utf8",
);
const globalJson = JSON.parse(
  readFileSync(new URL("../../global.json", import.meta.url), "utf8"),
);

test("self-contained Windows authority host uses the serviced SDK without a global runtime override", () => {
  assert.equal(globalJson.sdk.version, "10.0.403");
  assert.equal(globalJson.sdk.rollForward, "disable");
  assert.doesNotMatch(project, /<RuntimeFrameworkVersion>/);
});
