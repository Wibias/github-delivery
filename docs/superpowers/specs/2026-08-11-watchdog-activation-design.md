# Automatic Progress Watchdog Activation Design

## Problem

`github-delivery` v0.2.0 contains a runtime progress watchdog, Codex lifecycle-hook integration, and a Codex App Server streaming proxy, but the normal skill installer does not activate either runtime boundary. Users can therefore install or update the skill successfully and still observe the exact failure the watchdog was built to stop: hundreds of repeated assistant-intent lines such as `Let me check the type` before any tool call occurs.

The strongest detector already exists. The missing work is activation, capability selection, and end-to-end proof that a supported Codex launch actually uses the strongest boundary available.

## Goal

Make progress protection effective on supported Codex installations without weakening mutation, freshness, review, evidence, or Codex hook-trust gates and without silently rewriting unsupported host configuration.

Success means a normal Codex install/upgrade configures the available watchdog surfaces, records only the protection that is actually active, and an end-to-end incident regression proves that repeated low-novelty narration is interrupted before the configured output budget is exceeded when the protected streaming launcher is used.

## Non-goals

- Do not change the mutation-authority model.
- Do not make omitted evidence count as success.
- Do not require App Server streaming on hosts that cannot expose it.
- Do not replace Codex itself or assume an undocumented host interception API.
- Do not silently alter unrelated user hooks or editor configuration.
- Do not bypass Codex's persisted hook-trust review by default.

## Approaches considered

### A. Documentation-only activation

Keep hook/proxy installation separate and improve README/INSTALL instructions.

Rejected because it preserves the current failure mode: the protection can exist but remain unconfigured after a successful install.

### B. Always install lifecycle hooks

Make `install-skill.mjs` configure `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`, and `SessionEnd` hooks automatically for Codex targets.

Better than v0.2.0, but still cannot stop tokens already emitted inside a single assistant message. In addition, Codex requires non-managed command hooks to be reviewed and trusted by exact hook hash before they run. Configuration therefore must not be confused with active enforcement.

### C. Capability-driven activation with strongest-safe mode

Recommended. During install/upgrade, detect the target host and available watchdog integration surface, select `stream` only when a protected App Server launch boundary is actually controlled, otherwise select `hooks` only when lifecycle hooks are configured and their exact current definition is confirmed trusted, otherwise record `none` with a concrete degradation reason.

A fresh Codex install may therefore configure hooks automatically while reporting `none / hook_trust_required` until the user reviews them in `/hooks`. This preserves Codex's trust model instead of silently weakening it.

## Architecture

### 1. Activation planner

Add a deterministic activation planner with one input contract:

- installation target path;
- host hint/detection result;
- available integration capabilities;
- existing Codex hook configuration;
- whether the exact current hook definition is confirmed trusted;
- whether the caller requested apply vs dry-run.

It returns one of:

- `stream` — the caller/host can launch Codex through the protected streaming boundary;
- `hooks` — lifecycle hooks are configured and their exact current definition is confirmed trusted;
- `none` — no verified runtime boundary is active.

The planner must never infer `stream` merely because `codex` exists. Streaming is selected only when the actual launch boundary is under installer/host control.

The planner must never infer `hooks` merely because `hooks.json` contains the command. Codex skips non-managed hooks until their exact definition is trusted. A hook configuration change invalidates any prior trust assertion for activation purposes.

### 2. Installer integration

`install-skill.mjs` remains dry-run by default and continues to own skill files/backups. For Codex targets it also produces a watchdog activation plan.

On `--apply`:

- preflight the hook configuration before replacing the skill;
- install/upgrade the skill;
- configure the GitHub Delivery lifecycle-hook entries while preserving unrelated hooks;
- back up modified hook configuration before writing;
- record only a verified active mode;
- emit one structured result containing the installed version, watchdog mode, configured/trusted hook state, launcher path, and any degradation reason.

The existing standalone hook installer remains available for recovery/manual use but is no longer the normal required installation path.

Because Codex records trust against the exact hook definition hash, a newly added or changed hook is reported as `hook_trust_required` until it is reviewed in `/hooks`. The installer does not use `--dangerously-bypass-hook-trust` as a default activation mechanism.

### 3. Streaming launcher integration

GitHub Delivery installs a protected launcher owned by the skill. It starts the real Codex App Server on the default stdio transport, exposes an authenticated loopback bridge, and starts the ordinary Codex client with its documented `--remote` flags pointed at that bridge.

The bridge observes `item/agentMessage/delta` notifications and may issue one private `turn/interrupt` while the repeated narration is still being generated.

Installing the launcher alone does not make plain `codex` or an IDE session use it. `stream` is recorded only when the caller/host explicitly controls launches through this protected entry point. This avoids claiming a mid-message boundary that is not actually in the traffic path.

### 4. Runtime capability truth

`runtime-capabilities.mjs` reports the mode recorded by installation rather than relying only on an operator-set environment variable. Environment declarations may override or assist probing for controlled host integrations and fixtures, but a normal install leaves machine-readable activation state under the active Codex home.

Activation state contains no secrets, prompts, raw tool inputs, or conversation content. It may record:

- mode;
- degradation reason;
- protected launcher path;
- whether hooks are configured;
- whether trust for the exact current hook definition was verified.

### 5. Visible degradation

If hooks are configured but not confirmed trusted, the mode is `none` and the result reports `hook_trust_required` plus `hooksConfigured: true`.

If trusted hooks are active but streaming is not, the mode is `hooks` with `streaming_interruption_unavailable`.

If no runtime surface is available, installation does not fail solely for that reason but reports `progress_watchdog_unavailable`.

## Data flow

1. User runs the normal skill installer/upgrade.
2. Installer preflights skill replacement and watchdog configuration together.
3. The install configures available Codex lifecycle hooks without bypassing Codex trust review.
4. Host/capability evidence selects `stream`, trusted `hooks`, or `none`.
5. Dry-run reports exactly what would change.
6. `--apply` writes the skill, safe hook configuration, and a truthful activation receipt.
7. Runtime capability inspection reads the persisted receipt and confirms the effective mode.
8. The strongest in-flight protection is obtained by actually launching Codex through the protected streaming entry point.

## Safety and failure handling

- Host configuration writes remain backup-first and idempotent.
- Malformed or symlinked host configuration fails closed before skill replacement when it can be preflighted.
- A partial activation failure must not claim the requested watchdog mode.
- Hook installation preserves all unrelated hook entries.
- Non-managed hooks are never reported active solely because they are configured.
- A changed hook definition invalidates a supplied trust assertion for that install pass.
- The default workflow never adds `--dangerously-bypass-hook-trust`.
- Streaming launch integration never swallows ordinary App Server traffic, mutation prompts, or errors.
- The watchdog remains incapable of granting GitHub write authority.
- Existing `GD-CORE-*`, `GD-AUTH-*`, CI, review, security, and final-evidence rules remain authoritative.

## Testing strategy

### RED regression first

Add an end-to-end installation regression that installs to an isolated temporary Codex home and asserts that the normal installer configures lifecycle hooks without invoking the standalone installer. A fresh configuration must **not** be reported as active until hook trust is confirmed.

Add an incident regression using the real repeated phrase family from the observed trace (`Let me check the type`, `Let me check the NOUS_DEF type`, etc.). Under the protected streaming adapter, generated assistant deltas must trigger one `turn/interrupt` before the configured character budget is exceeded.

### Additional contracts

- normal Codex install configures lifecycle hooks automatically;
- newly configured non-managed hooks report `hook_trust_required`, not `hooks`;
- an explicit trust assertion is accepted only when the hook definition is unchanged;
- changing the hook definition invalidates the trust assertion;
- upgrade from v0.2.0 does not duplicate hook entries;
- existing unrelated hooks survive semantic-content unchanged;
- malformed/symlinked config fails closed;
- `stream` is selected only when the protected launch boundary is controlled;
- `none` is reported honestly on unsupported hosts;
- runtime capability output matches persisted effective mode;
- repeated install is idempotent;
- existing repository `npm run check`, distribution reproducibility, security, and cross-platform CI remain green.

## Acceptance criteria

1. A standard Codex install/upgrade no longer requires a second watchdog-install command to configure available lifecycle protection.
2. Codex's non-managed hook trust review remains intact; untrusted hooks are never reported active.
3. The installer chooses the strongest mode it can prove: controlled `stream` > trusted `hooks` > `none`.
4. The exact repeated `Let me check...` incident is interrupted in streaming mode before the configured generation budget is exceeded.
5. Hook-only installations clearly disclose that in-turn token burn cannot be stopped mid-message.
6. Runtime capability reporting reflects the mode actually active, not merely configured code.
7. Existing user configuration and GitHub Delivery safety/authority gates are preserved.
