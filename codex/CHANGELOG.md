# Changelog

All notable changes to this project will be documented in this file.

## [0.1.2] - 2026-08-20

### Fixed
- hass-mcp reported that no Home Assistant token was configured, so Codex could
  not read entities or call services. The add-on exports `HA_URL` and `HA_TOKEN`
  into its own environment, but Codex hands an MCP server only a fixed allowlist
  - `HOME`, `LOGNAME`, `PATH`, `SHELL`, `USER`, `LANG`, `LC_ALL`, `TERM` - plus
  whatever `env_vars` names, and drops everything else
  (`create_env_for_mcp_server` in `codex-rs/rmcp-client/src/utils.rs`). The
  generated config now sets `env_vars = ["HA_URL", "HA_TOKEN"]`, which forwards
  the values from the running process and still keeps the Supervisor token out
  of every file on disk

### Changed
- When Codex does not pick up `/etc/codex/config.toml`, the startup script now
  reports it as an error instead of falling back to `codex mcp add`. That
  fallback wrote to the user config, which cannot express `env_vars`, so the
  only way to give hass-mcp its token from there would be to persist the token

## [0.1.1] - 2026-08-20

### Fixed
- Codex warned `Code Mode is unavailable because failed to spawn code-mode host
  /usr/local/bin/codex-code-mode-host` on every start. `install-codex.sh` pulled
  only the `codex` binary and bubblewrap, but Codex also expects the code-mode
  host next to its own executable - the npm package and the upstream installer
  both vendor it. It is now installed the same way, and treated as non-fatal so
  a missing asset does not break the build

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
