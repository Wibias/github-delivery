import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { enrichSnapshotWithBaseHealth } from "./base-health-live.mjs";
import { validateSnapshot } from "./snapshot-input.mjs";

const SNAPSHOT_COMMAND = fileURLToPath(
  new URL("../ship-gate-snapshot.mjs", import.meta.url),
);

export function captureLiveSnapshot({ repo, pr, maxAgeSeconds = 300 } = {}) {
  const result = spawnSync(
    process.execPath,
    [SNAPSHOT_COMMAND, repo, String(pr)],
    {
      encoding: "utf8",
      maxBuffer: 100 * 1024 * 1024,
    },
  );
  let snapshot;
  try {
    snapshot = JSON.parse(result.stdout || "null");
  } catch {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(detail || "Snapshot capture returned invalid JSON");
  }
  if (!snapshot) {
    const detail = (result.stderr || "").trim();
    throw new Error(detail || "Snapshot capture produced no evidence");
  }
  const validation = validateSnapshot({
    snapshot,
    repo,
    pr,
    maxAgeSeconds,
    requireComplete: false,
  });
  if (!validation.valid) {
    throw new Error(`Invalid live snapshot: ${validation.reasons.join(", ")}`);
  }
  return enrichSnapshotWithBaseHealth(snapshot);
}
