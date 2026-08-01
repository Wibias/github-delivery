# Deterministic Skill Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build deterministic, versioned Agent Skill archives and a fail-safe installer.

**Architecture:** A dependency-free distribution library owns payload selection, validation, manifest creation, ZIP/tar generation, and installation planning. Thin CLIs call that library. Tests construct fixture skills in temporary directories.

**Tech Stack:** Node.js 20+ ESM, built-in `fs`, `path`, `crypto`, and `zlib`.

## Global Constraints

- Public interaction remains natural language; packaging scripts are maintainer tooling.
- No third-party runtime dependencies.
- Default installation behavior is dry-run and non-destructive.
- Build output from the same source commit must be byte-identical.

---

### Task 1: Distribution library

**Files:**
- Create: `scripts/lib/distribution.mjs`
- Test: `tests/unit/distribution.test.mjs`

- [ ] Write failing tests for payload selection, missing references, metadata injection, and deterministic archives.
- [ ] Run the focused test and confirm failures are caused by missing exports.
- [ ] Implement collection, normalization, validation, manifests, ZIP, tar.gz, and reproducibility comparison.
- [ ] Run the focused test and confirm it passes.

### Task 2: Build CLI

**Files:**
- Create: `scripts/build-dist.mjs`
- Modify: `package.json`

- [ ] Add CLI behavior tests through the distribution test fixture.
- [ ] Implement normal build and `--verify-reproducible` modes.
- [ ] Add `build:dist` and `dist:check` scripts.
- [ ] Run `npm run dist:check` against the fixture project.

### Task 3: Installer

**Files:**
- Create: `scripts/install-skill.mjs`
- Test: `tests/unit/installer.test.mjs`
- Create: `INSTALL.md`

- [ ] Write failing tests for absent targets, upgrades, blocked downgrades, backups, and restore.
- [ ] Implement planning and explicit apply/restore operations.
- [ ] Document copy and installer flows for common Agent Skill directories.
- [ ] Run the focused installer tests.

### Task 4: Metadata and repository integration

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] Set version `0.1.0` while retaining `private: true`.
- [ ] Add syntax checks and the new unit tests to the existing `check` command.
- [ ] Ignore generated `dist/` output.
- [ ] Run the full repository check and a fresh reproducibility build.
