export async function waitForObservedHead({
  readHead,
  expectedHead,
  timeoutMs = 60_000,
  intervalMs = 1_000,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (typeof readHead !== "function") throw new Error("readHead must be a function");
  if (!expectedHead) throw new Error("expectedHead is required");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new Error("timeoutMs must be non-negative");
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error("intervalMs must be positive");

  const startedAt = now();
  let observedHead = null;

  while (true) {
    observedHead = await readHead();
    if (observedHead === expectedHead) return observedHead;

    const elapsed = now() - startedAt;
    if (elapsed >= timeoutMs) {
      const error = new Error(
        `fixture head propagation timed out: expected ${expectedHead}, observed ${observedHead || "missing"}`,
      );
      error.code = "fixture_head_propagation_timeout";
      error.expectedHead = expectedHead;
      error.observedHead = observedHead || null;
      throw error;
    }

    await sleep(Math.min(intervalMs, timeoutMs - elapsed));
  }
}
