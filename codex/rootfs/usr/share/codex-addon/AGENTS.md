# Codex - Home Assistant Add-on

## Path Mapping

In this add-on container, paths are mapped differently than HA Core:
- `/homeassistant` = HA config directory (equivalent to `/config` in HA Core)
- `/config` does NOT exist - always use `/homeassistant`

When users mention `/config/...`, translate to `/homeassistant/...`

## Available Paths

| Path | Description | Access |
|------|-------------|--------|
| `/homeassistant` | HA configuration | read-write |
| `/share` | Shared folder | read-write |
| `/media` | Media files | read-write |
| `/ssl` | SSL certificates | read-only |
| `/backup` | Backups | read-only |

## Home Assistant Integration

Use the `homeassistant` MCP server to query entities and call services.

## Reading Home Assistant Logs

**Log levels (from most to least verbose):**
- `debug` - Only shown if explicitly enabled in configuration.yaml
- `info` - General information, shown by default
- `warning` - Warnings, always shown
- `error` - Errors, always shown

**Commands to read logs:**
```bash
# View recent logs (ha CLI)
ha core logs 2>&1 | tail -100

# Filter by keyword
ha core logs 2>&1 | grep -i keyword

# Filter errors only
ha core logs 2>&1 | grep -iE "(error|exception)"

# Alternative: read log file directly
tail -100 /homeassistant/home-assistant.log
```

**To enable debug logging for an integration**, add to `configuration.yaml`:
```yaml
logger:
  default: info
  logs:
    custom_components.YOUR_INTEGRATION: debug
```

**Key insight:** `_LOGGER.debug()` calls are invisible unless the logger level is set to debug. Use `_LOGGER.info()` or `_LOGGER.warning()` for logs that should always appear.

## Restarting Home Assistant

Config changes need a restart (or a targeted reload) to take effect. Check the
configuration first - a restart on a broken YAML file leaves HA down:

```bash
ha core check
ha core restart
```

## Add-on Notes

- The add-on refreshes this file on start, but only while it is still the copy
  the add-on installed - your edits are kept, and reported in the startup log.
  Prefer `/homeassistant/.codex/AGENTS.override.md` for your own standing
  instructions: Codex loads it instead of this file when present, so it never
  competes with add-on updates.
- Add-on settings (model, approval policy, sandbox mode, MCP servers) come from
  `/etc/codex/config.toml`, regenerated on every start from the add-on options.
  Your own `/homeassistant/.codex/config.toml` overrides it.
