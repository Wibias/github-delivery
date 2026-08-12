import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

import {
  discoverInstallations,
  parseBootstrapArgs,
} from "./bootstrap-cli.mjs";
import { runGuidedInstall } from "./bootstrap-install.mjs";
import {
  runBootstrapDoctor,
  runBootstrapSetup,
  runBootstrapUpdate,
} from "./bootstrap-maintenance.mjs";

function fail(code) {
  throw new Error(code);
}

function defaultTarget() {
  return join(homedir(), ".agents", "skills", "github-delivery");
}

async function ask(question, { input = process.stdin, output = process.stdout } = {}) {
  const rl = createInterface({ input, output });
  try {
    return await rl.question(question);
  } catch {
    return "";
  } finally {
    rl.close();
  }
}

export async function chooseExistingAction({
  input = process.stdin,
  output = process.stdout,
  ask: askImpl = ask,
} = {}) {
  const answer = String(await askImpl(
    "Existing GitHub Delivery installation found. Choose: [u]pdate, [r]epair setup, [e]xit: ",
    { input, output },
  ) || "").trim().toLowerCase();
  if (answer === "u" || answer === "update") return "update";
  if (answer === "r" || answer === "repair" || answer === "setup") return "setup";
  return "exit";
}

export async function chooseInstallation(installations, {
  input = process.stdin,
  output = process.stdout,
  ask: askImpl = ask,
} = {}) {
  if (!Array.isArray(installations) || installations.length === 0) return null;
  if (installations.length === 1) return installations[0];
  if (output?.write) {
    output.write("Multiple GitHub Delivery installations found:\n");
    installations.forEach((entry, index) => {
      output.write(`  ${index + 1}. ${entry.target} (${entry.version || "unknown"})\n`);
    });
  }
  const answer = String(await askImpl("Select installation number, or press Enter to exit: ", { input, output }) || "").trim();
  if (!/^\d+$/.test(answer)) return null;
  const index = Number(answer) - 1;
  return installations[index] || null;
}

function selectSingleTarget(options, installations, code) {
  if (options.target) return resolve(options.target);
  const valid = installations.filter((entry) => entry.valid === true);
  if (valid.length === 1) return resolve(valid[0].target);
  if (valid.length === 0) fail(code);
  fail("bootstrap_installation_ambiguous");
}

export async function runBootstrap(argv = [], dependencies = {}) {
  const parse = dependencies.parseBootstrapArgs || parseBootstrapArgs;
  const discover = dependencies.discoverInstallations || discoverInstallations;
  const install = dependencies.runGuidedInstall || runGuidedInstall;
  const update = dependencies.runBootstrapUpdate || runBootstrapUpdate;
  const setup = dependencies.runBootstrapSetup || runBootstrapSetup;
  const doctor = dependencies.runBootstrapDoctor || runBootstrapDoctor;
  const chooseAction = dependencies.chooseExistingAction || chooseExistingAction;
  const chooseTarget = dependencies.chooseInstallation || chooseInstallation;
  const options = parse(argv);

  if (options.help) return { action: "help" };

  if (options.command === "install") {
    return install({ target: options.target || defaultTarget() });
  }

  const installations = discover(options.target ? { explicitTarget: options.target } : {});

  if (options.command === "update") {
    const target = selectSingleTarget(options, installations, "bootstrap_update_installation_missing");
    return update({ target, apply: options.apply });
  }
  if (options.command === "setup") {
    const target = selectSingleTarget(options, installations, "bootstrap_setup_installation_missing");
    return setup({ target });
  }
  if (options.command === "doctor") {
    if (options.target) return doctor({ target: resolve(options.target) });
    const valid = installations.filter((entry) => entry.valid === true);
    if (valid.length > 1) fail("bootstrap_installation_ambiguous");
    return doctor({ target: valid[0]?.target || null });
  }

  const valid = installations.filter((entry) => entry.valid === true);
  if (valid.length === 0) {
    return install({ target: defaultTarget() });
  }

  const selected = await chooseTarget(valid);
  if (!selected) return { action: "exit", target: null };
  const action = await chooseAction({ target: selected.target, version: selected.version });
  if (action === "update") return update({ target: selected.target, apply: false });
  if (action === "setup") return setup({ target: selected.target });
  return { action: "exit", target: selected.target };
}
