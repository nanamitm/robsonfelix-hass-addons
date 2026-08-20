# Repository Instructions

Instructions for any coding agent working on this repository. `CLAUDE.md` points
here so that Claude Code and Codex read the same file.

## Before Every Commit

**IMPORTANT:** Update `codex/CHANGELOG.md` and bump `version` in
`codex/config.yaml` before making any commit that changes the add-on. Home
Assistant only offers an update when the version changes, so a fix without a
bump never reaches an installed add-on. Follow the existing format:

```markdown
## [VERSION] - YYYY-MM-DD

### Added/Changed/Fixed
- Description of change
```

## Project Structure

- `repository.yaml` - Add-on repository metadata
- `codex/` - Codex add-on
  - `config.yaml` - Add-on configuration (bump version here)
  - `Dockerfile` - Container build instructions
  - `build.yaml` - Multi-architecture build settings
  - `install-codex.sh` - Installs the Codex CLI, its code-mode host and
    bubblewrap from the official release channel; runs at build time and again
    at startup when `auto_update_codex` is on
  - `rootfs/usr/bin/codex-addon-start.sh` - Entrypoint: renders the add-on
    options into `/etc/codex/config.toml`, then execs ttyd
  - `rootfs/usr/share/codex-addon/AGENTS.md` - Global instructions installed
    into `$CODEX_HOME` on every start
  - `CHANGELOG.md` - Version history (**update before commits**)
  - `apparmor.txt` - Security profile; the profile name must match the slug

## Codex Add-on Notes

- Add-on options go into `/etc/codex/config.toml`, the lowest-precedence config
  layer, so the user's `/homeassistant/.codex/config.toml` always wins and the
  add-on never writes to it
- Codex hands an MCP server only a fixed allowlist of environment variables, so
  anything else it needs must be named in `env_vars` on the server
- `CODEX_HOME=/homeassistant/.codex` keeps sign-in and sessions across rebuilds;
  AppArmor grants exec there because Codex materialises helper binaries under it
- Codex's own sandbox needs bubblewrap and a user namespace, which an add-on
  container cannot create, so `sandbox_mode` defaults to `danger-full-access`
- Codex publishes Linux binaries for x86_64 and aarch64 only

## Home Assistant Add-on Notes

- Rebuild button only rebuilds from cached config
- To pick up config.yaml changes: uninstall/reinstall or bump version and update
- Base images use s6-overlay v3 - be careful with init configuration
- `init: true` uses Docker's tini, `init: false` uses s6-overlay's /init
