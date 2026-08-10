const SAFE_EXECUTABLE_RE = /^[A-Za-z0-9._+-]+(?:\.exe)?$/i;

function validateRegistry(registry) {
  if (!Array.isArray(registry)) throw new TypeError("capability registry must be an array");
  const ids = new Set();
  for (const item of registry) {
    if (!item?.id || typeof item.id !== "string") throw new TypeError("capability registry entry requires id");
    if (ids.has(item.id)) throw new TypeError(`duplicate capability id: ${item.id}`);
    ids.add(item.id);
    if (!Array.isArray(item.commands) || item.commands.length === 0) {
      throw new TypeError(`capability ${item.id} requires probe commands`);
    }
    for (const spec of item.commands) {
      if (!spec || typeof spec !== "object" || !SAFE_EXECUTABLE_RE.test(String(spec.command || ""))) {
        throw new TypeError(`unsafe capability command: ${spec?.command || "<missing>"}`);
      }
      if (!Array.isArray(spec.args) || spec.args.some((arg) => typeof arg !== "string")) {
        throw new TypeError(`capability command args must be strings for ${spec.command}`);
      }
    }
  }
}

function normalize(value) {
  return {
    status: Number.isInteger(value?.status) ? value.status : null,
    stdout: String(value?.stdout || "").trim(),
    stderr: String(value?.stderr || "").trim(),
    errorCode: value?.errorCode ? String(value.errorCode) : null,
  };
}

function label(spec) {
  return [spec.command, ...spec.args].join(" ");
}

export function collectCapabilityInventory({ registry, runner } = {}) {
  validateRegistry(registry);
  if (typeof runner !== "function") throw new TypeError("capability inventory requires a runner function");

  const capabilities = {};
  const order = [];

  for (const item of registry) {
    order.push(item.id);
    const attempts = [];
    let record = null;

    for (const spec of item.commands) {
      let raw;
      try {
        raw = runner({ command: spec.command, args: [...spec.args], capabilityId: item.id });
      } catch (error) {
        raw = { status: null, errorCode: error?.code || "runner-error", stderr: String(error?.message || error) };
      }
      const result = normalize(raw);
      attempts.push({ command: label(spec), status: result.status, errorCode: result.errorCode });

      if (result.status === 0) {
        record = {
          id: item.id,
          status: "available",
          command: label(spec),
          versionEvidence: result.stdout || result.stderr || "probe succeeded",
          detail: null,
          attempts,
        };
        break;
      }
      if (result.errorCode === "ENOENT" || result.errorCode === "not-found") continue;

      record = {
        id: item.id,
        status: "error",
        command: label(spec),
        versionEvidence: null,
        detail: result.stderr || result.stdout || `probe exited with status ${result.status ?? "unknown"}`,
        attempts,
      };
      break;
    }

    capabilities[item.id] = record || {
      id: item.id,
      status: "unavailable",
      command: null,
      versionEvidence: null,
      detail: "No declared probe command was available.",
      attempts,
    };
  }

  return {
    schemaVersion: 1,
    kind: "github-delivery/capability-inventory",
    order,
    capabilities,
    mutationsPerformed: false,
    installAttempts: 0,
    instructions: [
      "Inventory is observational only; missing optional capabilities remain unavailable.",
      "Do not change the environment while collecting capability evidence.",
      "Capability presence does not grant workflow authority to invoke it.",
    ],
  };
}
