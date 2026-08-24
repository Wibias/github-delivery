import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("Off-mode user-facing docs preserve the independently authenticated intent exception", () => {
  const controlCenter = read(
    "authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml",
  );
  const configuration = read("references/configuration.md");
  const authorityReadme = read("authority-host/windows/README.md");
  const install = read("INSTALL.md");
  const setupPrompts = read("references/setup-prompts.md");

  assert.doesNotMatch(controlCenter, /No Windows Hello prompts\./);
  assert.match(
    controlCenter,
    /Independent lifecycle intent and exact-text human replies still require Windows Hello\./,
  );

  assert.doesNotMatch(
    configuration,
    /Off[^\n]*never require Windows Hello for github-delivery mutations/i,
  );
  assert.match(configuration, /independent(?:ly authenticated)? lifecycle intent/i);
  assert.match(authorityReadme, /independent(?:ly authenticated)? lifecycle intent/i);
  assert.match(install, /independent(?:ly authenticated)? lifecycle intent/i);
  assert.doesNotMatch(setupPrompts, /Disable Windows Hello protection for github-delivery\./);
  assert.match(setupPrompts, /independently authenticated lifecycle intent/i);
});
