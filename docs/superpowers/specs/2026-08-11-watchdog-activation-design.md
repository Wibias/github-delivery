# Automatic Progress Watchdog Activation Design

## Problem

`github-delivery` v0.2.0 contains a runtime progress watchdog, Codex lifecycle-hook integration, and a Codex App Server streaming proxy, but the normal skill installer does not activate either runtime boundary. Users can therefore install or update the skill successfully and still observe the exact failure the watchdog was built to stop: hundreds of repeated assistant-intent lines such as `Let me check the type` before any tool call occurs.

The strongest detector already exists. The missing work is activation, capability selection, and end-to-end proof that a supported Codex install actually uses the strongest boundary available.

## Goal

Make progress protection effective by default on supported Codex installations without weakening mutation, freshness, review, or evidence gates and without silently rewriting unsupported host configuration.

Success means a normal supported install/upgrade chooses and activates the strongest watchdog mode it can safely use, records the resulting mode, and an end-to-end incident regression proves that repeated low-novelty narration is interrupted before the configured output budget is exceeded.

## Non-goals

- Do not change the mutation-authority model.
- Do not make omitted evidence count as success.
- Do not require App Server streaming on hosts that cannot expose it.
- Do not replace Codex itself or assume an undocumented host interception API.
- Do not silently alter unrelated user hooks or editor configuration.

## Approaches considered

### A. Documentation-only activation

Keep hook/proxy installation separate and improve README/INSTALL instructions.

Rejected because it preserves the current failure mode: the protection can exist but remain inactive after a successful install.

### B. Always install lifecycle hooks

Make `install-skill.mjs` install `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`, and `SessionEnd` hooks automatically for Codex targets.

Better than today, but still cannot stop tokens already emitted inside a single assistant message. It solves tool-boundary waste but not the incident that motivated this PR.

### C. Capability-driven activation with strongest-safe mode

Recommended. During install/upgrade, detect the target host and available watchdog integration surface, select `stream` when an App Server launch boundary is actually controllable, otherwise select `hooks` when Codex lifecycle hooks are supported, otherwise record `none` and surface the degradation clearly. Installation remains idempotent and preserves unrelated configuration.

This is the only approach that both fixes the activation trap and keeps unsupported hosts safe.

## Architecture

### 1. Activation planner

Add a deterministic activation planner with one input contract:

- installation target path;
- host hint/detection result;
- available integration capabilities;
- existing Codex hook configuration;
- whether the caller requested apply vs dry-run.

It returns one of:

- `stream` — the caller/host can launch Codex through the watchdog App Server proxy;
- `hooks` — lifecycle hooks can be safely installed and used;
- `none` — no enforceable runtime boundary is available.

The planner must never infer `stream` merely because `codex` exists. Streaming is selected only when the actual launch boundary is under installer/host control.

### 2. Installer integration

`install-skill.mjs` remains dry-run by default and continues to own skill files/backups. For Codex targets it also produces a watchdog activation plan.

On `--apply`:

- install/upgrade the skill first;
- activate the selected watchdog mode;
- preserve unrelated hooks/configuration;
- back up any modified host configuration before writing;
- emit one structured result containing the installed version, watchdog mode, changed files/configuration, and any degradation reason.

The existing standalone hook installer remains available for recovery/manual use but is no longer the normal required path after a Codex install.

### 3. Streaming launcher integration

When `stream` is selected, installation must create or update a stable launcher/adapter owned by GitHub Delivery rather than asking the user to remember a different command. The launcher delegates to `scripts/codex-app-server-watchdog-proxy.mjs` and is referenced by the supported Codex/App Server integration point.

If the current Codex surface does not provide a safe way for the installer to replace or configure that launch boundary, the planner must choose `hooks`, not pretend that streaming is active.

### 4. Runtime capability truth

`runtime-capabilities.mjs` must report the mode actually activated by installation rather than relying only on an operator-set environment variable. Environment declarations may override or assist probing for controlled CI/fixtures, but a successful normal install should leave machine-readable activation state that runtime inspection can verify.

Activation state must contain no secrets, prompts, raw tool inputs, or conversation content.

### 5. Visible degradation

If only `hooks` is available, the install result must explicitly say that tool-boundary protection is active but in-turn narration cannot be interrupted until `Stop`.

If mode is `none`, installation must not fail solely because the host lacks a watchdog surface, but it must clearly report `progress_watchdog_unavailable` so users are not told they are protected when they are not.

## Data flow

1. User runs the normal skill installer/upgrade.
2. Installer plans skill replacement and watchdog activation together.
3. Host/capability probe selects `stream`, `hooks`, or `none`.
4. Dry-run reports exactly what would change.
5. `--apply` installs the skill and applies only the selected supported activation.
6. Runtime capability inspection reads the persisted activation receipt and confirms the effective mode.
7. A workflow uses the watchdog through that boundary without requiring the user to remember a second installer command.

## Safety and failure handling

- Host configuration writes remain atomic, backup-first, and idempotent.
- Malformed or symlinked host configuration fails closed before modification.
- A partial activation failure must not claim the requested watchdog mode. The result records the lower verified mode or `none`.
- Hook installation must preserve all unrelated hook entries.
- Streaming launch integration must never swallow ordinary App Server traffic, mutation prompts, or errors.
- The watchdog remains incapable of granting GitHub write authority.
- Existing `GD-CORE-*`, `GD-AUTH-*`, CI, review, security, and final-evidence rules remain authoritative.

## Testing strategy

### RED regression first

Add an end-to-end installation regression that installs to an isolated temporary Codex home, runs the normal installer, and asserts the expected activation mode without invoking the standalone hook installer.

Add an incident regression using the real repeated phrase family from the observed trace (`Let me check the type`, `Let me check the NOUS_DEF type`, etc.). Under the `stream` adapter, the generated assistant deltas must trigger one `turn/interrupt` before the configured character budget is exceeded.

### Additional contracts

- normal Codex install activates the strongest supported mode automatically;
- upgrade from v0.2.0 does not duplicate hook entries;
- existing unrelated hooks survive byte-for-semantic-content unchanged;
- malformed/symlinked config fails closed;
- `hooks` is selected when streaming cannot be controlled;
- `none` is reported honestly on unsupported hosts;
- runtime capability output matches the persisted effective mode;
- repeated install is idempotent;
- uninstall/restore does not leave a false `stream`/`hooks` receipt;
- existing repository `npm run check`, distribution reproducibility, security, and cross-platform CI remain green.

## Acceptance criteria

1. A standard supported Codex install/upgrade no longer requires a second manual watchdog-install command to obtain available protection.
2. The installer chooses the strongest mode it can prove: `stream` > `hooks` > `none`.
3. The exact repeated `Let me check...` incident is interrupted in streaming mode before the configured generation budget is exceeded.
4. Hook-only installations clearly disclose that in-turn token burn cannot be stopped mid-message.
5. Runtime capability reporting reflects the mode actually installed.
6. Existing user configuration and GitHub Delivery safety/authority gates are preserved.
