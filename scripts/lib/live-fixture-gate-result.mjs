function fixtureGateError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function parseFixtureGateResult({ status, stdout, stderr } = {}) {
  const exit = Number.isInteger(status) ? status : "unknown";
  const output = String(stdout || "").trim();
  const diagnostic = String(stderr || "").trim();

  if (!output) {
    throw fixtureGateError(
      "fixture_gate_no_output",
      `ship gate produced no JSON (exit ${exit}): ${diagnostic || "no diagnostic output"}`,
    );
  }

  let raw;
  try {
    raw = JSON.parse(output);
  } catch {
    throw fixtureGateError(
      "fixture_gate_invalid_json",
      `ship gate returned invalid JSON (exit ${exit}): ${diagnostic || output.slice(0, 500)}`,
    );
  }

  if (
    typeof raw?.ready !== "boolean" ||
    typeof raw?.blocked !== "boolean" ||
    (raw.ready && raw.blocked)
  ) {
    throw fixtureGateError(
      "fixture_gate_invalid_decision",
      `ship gate returned an invalid decision envelope (exit ${exit})`,
    );
  }

  return {
    decision: raw.ready ? "ready" : raw.blocked ? "blocked" : "unknown",
    raw,
  };
}
