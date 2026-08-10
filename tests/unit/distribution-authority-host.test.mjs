import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildDistribution } from "../../scripts/lib/distribution.mjs";

test("release distribution bundles the Windows authority host", () => {
  const root = mkdtempSync(join(tmpdir(), "github-delivery-authority-dist-"));
  const host = join(root, "authority-host", "windows", "GitHubDeliveryAuthority");
  mkdirSync(host, { recursive: true });

  writeFileSync(
    join(root, "SKILL.md"),
    "---\nname: github-delivery\ndescription: GitHub shipping skill.\n---\n\nRuntime.\n",
  );
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "github-delivery", version: "0.1.0" }) + "\n",
  );
  writeFileSync(
    join(root, "authority-host", "windows", "README.md"),
    "# Windows authority host\n",
  );
  writeFileSync(
    join(root, "authority-host", "windows", "install.ps1"),
    "dotnet publish\n",
  );
  writeFileSync(
    join(host, "GitHubDeliveryAuthority.csproj"),
    "<Project Sdk=\"Microsoft.NET.Sdk\" />\n",
  );
  writeFileSync(join(host, "Program.cs"), "Console.WriteLine(\"host\");\n");

  const result = buildDistribution({
    root,
    out: join(root, "dist"),
    sourceCommit: "a".repeat(40),
  });
  const paths = result.manifest.files.map((file) => file.path);

  assert(paths.includes("authority-host/windows/README.md"));
  assert(paths.includes("authority-host/windows/install.ps1"));
  assert(paths.includes("authority-host/windows/GitHubDeliveryAuthority/GitHubDeliveryAuthority.csproj"));
  assert(paths.includes("authority-host/windows/GitHubDeliveryAuthority/Program.cs"));
});
