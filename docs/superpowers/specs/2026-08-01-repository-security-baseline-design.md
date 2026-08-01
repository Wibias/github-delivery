# Repository security baseline design

## Goal

Version the supply-chain workflows and desired GitHub repository policy, then fail CI when workflow permissions or action pins drift outside the approved boundary.

## Controls

- Dependabot for npm and GitHub Actions
- dependency review on every pull request
- CodeQL on pull requests, main pushes, and a weekly schedule
- OpenSSF Scorecard on main, branch-protection changes, and a weekly schedule
- root security policy with explicit trust boundaries and invariants
- machine-readable desired repository policy for main and releases
- offline validator for action pins, checkout credentials, permissions, and dangerous triggers

## Administrative boundary

The repository stores desired settings but does not pretend that JSON or Markdown applies GitHub rulesets, environments, secret scanning, or merge settings. An administrator must apply and later audit those live controls.
