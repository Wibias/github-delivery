#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { readUserConfig } from "./lib/user-config.mjs";
import {
  planStableUpdate,
  verifyDownloadedAsset,
} from "./lib/stable-release-update.mjs";

const REPOSITORY = "Wibias/github-delivery";

function command(program, args, { json = false } = {}) {
  const result = spawnSync(program, args, { encoding: json ? "utf8" : undefined, stdio: json ? "pipe" : "inherit" });
  if (result.status !== 0) {
    const detail = json ? String(result.stderr || result.stdout || "").trim() : "";
    throw new Error(detail || `update_command_failed:${program}:${result.status ?? "unknown"}`);
  }
  return json ? String(result.stdout || "") : "";
}

export function parseUpdateArgs(argv = []) {
  const options = {
    target: join(homedir(), ".agents", "skills", "github-delivery"),
    apply: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--target") options.target = argv[++index];
    else if (arg === "--apply") options.apply = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  options.target = resolve(options.target);
  return options;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseUpdateArgs(argv);
  const releases = JSON.parse(command("gh", ["api", `repos/${REPOSITORY}/releases?per_page=100`], { json: true }));
  const plan = planStableUpdate({ releases, target: options.target });
  const userConfigBefore = readUserConfig();

  if (!options.apply || plan.action !== "update") {
    const result = { ...plan, apply: false, userConfig: userConfigBefore };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  }
  if (!plan.safeToReplace) throw new Error("stable_update_blocked_local_modifications");

  const workspace = mkdtempSync(join(tmpdir(), "github-delivery-update-"));
  try {
    command("gh", [
      "release", "download", plan.release.tag,
      "--repo", REPOSITORY,
      "--pattern", plan.assets.archive,
      "--pattern", plan.assets.manifest,
      "--pattern", plan.assets.checksums,
      "--dir", workspace,
    ]);
    const checksums = readFileSync(join(workspace, plan.assets.checksums), "utf8");
    for (const name of [plan.assets.archive, plan.assets.manifest]) {
      verifyDownloadedAsset({ name, content: readFileSync(join(workspace, name)), checksums });
    }
    const releaseManifest = JSON.parse(readFileSync(join(workspace, plan.assets.manifest), "utf8"));
    if (releaseManifest.version !== plan.release.version) throw new Error("stable_release_manifest_version_mismatch");

    const extracted = join(workspace, "extracted");
    mkdirSync(extracted, { recursive: true });
    command("tar", ["-xf", join(workspace, plan.assets.archive), "-C", extracted]);
    const source = join(extracted, "github-delivery");
    command(process.execPath, [
      join(source, "scripts", "install-skill.mjs"),
      "--source", source,
      "--target", options.target,
      "--apply",
    ]);

    const userConfigAfter = readUserConfig();
    if (JSON.stringify(userConfigAfter.config) !== JSON.stringify(userConfigBefore.config)) {
      throw new Error("stable_update_user_config_changed_unexpectedly");
    }
    const result = {
      ...plan,
      apply: true,
      updated: true,
      configurationPreserved: true,
      userConfig: userConfigAfter,
      configurationReviewRequired: true,
      configurationReviewReason: "compare_existing_config_with_new_release_supported_options",
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); }
  catch (error) {
    process.stderr.write(`${JSON.stringify({ error: String(error?.message || error) })}\n`);
    process.exitCode = 1;
  }
}
