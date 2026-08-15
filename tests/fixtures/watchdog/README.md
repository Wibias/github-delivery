# Watchdog incident fixtures

These fixtures turn real no-progress incidents into deterministic replay coverage instead of leaving them as anecdotal transcripts.

## Provenance rules

- Preserve the failure pattern and representative generated text from the incident.
- Remove repository paths, usernames, secrets, tokens, and unrelated task content.
- Record when transport/channel metadata is reconstructed rather than observed.
- Never add model-specific runtime branching just because a fixture came from one model. Model names may identify regression cases; enforcement stays behavior-based.

## DeepSeek parameter/tool-emission incident

`deepseek-parameter-loop.json` is derived from a user-supplied August 15, 2026 transcript in which the model repeatedly produced `Running`, `Executing`, `Let me run it`, and `<parameter name="...">` scaffolding before real tool execution.

The source transcript did not include raw Codex App Server event metadata, so the fixture explicitly marks its generated-text channel assignments as synthetic. The generated text itself is sanitized from the real incident.

The release-blocking replay coverage requires four behaviors:

1. `deepseek_parameter_tool_emission_loop` interrupts within six imminent-tool events, with high-confidence protocol leakage allowed to stop it earlier.
2. `deepseek_repeated_execution_narration` cannot evade the six-clause tool-emission bound by varying `Running` / `Executing` wording.
3. `deepseek_parameter_channel_hopping` shares one budget across supported generated-text channels.
4. `deepseek_tool_markup_then_real_tool` proves that a real tool boundary clears only the pending tool-emission stall signal so legitimate execution can proceed without inheriting a false interrupt.

Ordinary XML documentation remains covered separately by false-positive tests. Generic parameter names such as `cmd` and `workdir` are useful for wrapper normalization but are not, by themselves, sufficient evidence of malformed tool-protocol emission.
