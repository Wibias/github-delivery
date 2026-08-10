# Read-only capability inventory

Use the capability inventory when an optional workflow may use external tooling and needs to know what is already present in the current host.

Run:

```bash
node scripts/capability-inventory.mjs
```

The inventory is **observational only**. It may execute fixed version/probe commands for already-present tools. It must not install, update, configure, bootstrap, download, or otherwise mutate the host to make a capability available.

## Contract

Each capability is one of:

- `available` — a declared read-only probe command completed successfully, with command/version evidence;
- `unavailable` — no declared executable/alias was present;
- `error` — the executable exists or was reached, but its read-only probe failed.

The result records `mutationsPerformed: false` and `installAttempts: 0`.

## Probe safety

- Commands are represented as one executable token plus an argument array. Shell command strings are rejected.
- The CLI executes with `shell: false` and a bounded timeout.
- Alternate probes may discover an already-installed local package, for example `npx --no-install promptfoo --version`; they must not fetch or install it.
- A failing capability does not stop unrelated capability discovery.

## Authority separation

Presence is not permission. An `available` result only says a capability exists in the host. The selected GitHub Delivery workflow still decides whether invoking that tool is allowed and relevant.

Likewise, absence is not permission to weaken review. Required native Bug/Security/Spec/Standards/probe/ship-gate obligations stay in force when an optional tool is unavailable.

## Intended consumers

This is the shared discovery primitive for optional integrations such as Promptfoo, PyRIT, garak, static-analysis helpers, and local review tooling. Consumers should use the inventory instead of each inventing their own bootstrap/install behavior.
