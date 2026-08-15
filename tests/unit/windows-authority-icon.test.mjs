import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../authority-host/windows/GitHubDeliveryAuthority/", import.meta.url);
const projectUrl = new URL("GitHubDeliveryAuthority.csproj", root);
const windowCodeUrl = new URL("ControlCenterWindow.xaml.cs", root);
const iconUrl = new URL("Assets/DeliveryAuthority.ico", root);

function readText(url) {
  return readFileSync(url, "utf8");
}

function readIcoSizes(buffer) {
  assert.ok(buffer.length >= 6, "ICO header must be present");
  assert.equal(buffer.readUInt16LE(0), 0, "ICO reserved field must be zero");
  assert.equal(buffer.readUInt16LE(2), 1, "ICO type must be icon");
  const count = buffer.readUInt16LE(4);
  assert.ok(count > 0, "ICO must contain at least one image");
  assert.ok(buffer.length >= 6 + (count * 16), "ICO directory must be complete");

  const sizes = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + (index * 16);
    const width = buffer[offset] === 0 ? 256 : buffer[offset];
    const height = buffer[offset + 1] === 0 ? 256 : buffer[offset + 1];
    sizes.push(`${width}x${height}`);
  }
  return sizes;
}

test("Authority ships the approved multi-resolution peach application icon", () => {
  assert.equal(existsSync(iconUrl), true, "Assets/DeliveryAuthority.ico must exist");
  if (!existsSync(iconUrl)) return;

  const sizes = new Set(readIcoSizes(readFileSync(iconUrl)));
  for (const size of [16, 20, 24, 32, 40, 48, 64, 128, 256]) {
    assert.equal(sizes.has(`${size}x${size}`), true, `ICO must contain ${size}x${size}`);
  }
});

test("Authority embeds and copies the same icon for executable and runtime window identity", () => {
  const project = readText(projectUrl);
  const code = readText(windowCodeUrl);

  assert.match(project, /<ApplicationIcon>Assets\\DeliveryAuthority\.ico<\/ApplicationIcon>/);
  assert.match(project, /<Content Include="Assets\\DeliveryAuthority\.ico">[\s\S]*<CopyToOutputDirectory>PreserveNewest<\/CopyToOutputDirectory>[\s\S]*<CopyToPublishDirectory>PreserveNewest<\/CopyToPublishDirectory>/);

  assert.match(code, /TrySetWindowIcon\(\)/);
  assert.match(code, /Path\.Combine\(AppContext\.BaseDirectory, "Assets", "DeliveryAuthority\.ico"\)/);
  assert.match(code, /appWindow\.SetIcon\(iconPath\)/);
  assert.match(code, /catch\s*\{[\s\S]*Window icon setup is best effort\./);
});
