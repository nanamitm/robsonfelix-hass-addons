# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-08-20

Initial release: a Codex CLI port of the Claude Code add-on.

### Added
- OpenAI Codex CLI installed from the official release channel
  (`releases.openai.com`), verified against the published SHA-256, with
  `auto_update_codex` re-running the same installer on every start
- Add-on options for `model`, `approval_policy`, `sandbox_mode` and
  `model_reasoning_effort`, rendered into `/etc/codex/config.toml` - the
  lowest-precedence config layer - so `/homeassistant/.codex/config.toml` stays
  the user's alone and always wins
- `CODEX_HOME=/homeassistant/.codex`, so sign-in, sessions and config survive
  restarts, rebuilds and reinstalls without the symlink dance the Claude Code
  add-on needs
- `AGENTS.md` describing the add-on's path mapping and log access, rewritten on
  every start; user instructions belong in `AGENTS.override.md`, which Codex
  prefers
- `/homeassistant` is registered as a trusted project, so Codex does not ask
  about the working directory on every start
- The startup log warns when a sandboxed `sandbox_mode` cannot work, instead of
  letting Codex panic on the first command it runs
- The startup script verifies that Codex really merged the generated config
  layer, and falls back to `codex mcp add` if a future release stops doing so

### Changed from the Claude Code add-on
- Architectures are amd64 and aarch64 only; Codex publishes no armv7, armhf or
  i386 Linux binaries
- The startup logic moved out of a single inline `CMD` string into
  `/usr/bin/codex-addon-start.sh`
- `install-claude.sh` is gone: its version binary-search worked around a Bun/AVX
  problem specific to Claude Code
- The Remote Control options are gone; Codex's equivalent is still hidden and
  experimental
- AppArmor grants exec under `/homeassistant/.codex`, where Codex materialises
  helper binaries, and write access to `/etc/codex`
- Aliases are `c` for `codex` and `cc` for `codex resume --last`
