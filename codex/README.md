# Codex for Home Assistant

Run [OpenAI Codex](https://developers.openai.com/codex), the Codex CLI coding
agent, directly in your Home Assistant sidebar with full access to your
configuration.

## Quick Start

```bash
codex "List all my automations"
codex "Turn off all lights in the living room"
codex "Create an automation to turn on lights at sunset"
codex "Why isn't my motion sensor automation working?"
```

## Requirements

- Home Assistant OS or Supervised installation on amd64 or aarch64
- A ChatGPT plan that includes Codex, or an OpenAI API key

Codex publishes Linux binaries for x86_64 and aarch64 only, so unlike the Claude
Code add-on this is derived from, armv7, armhf and i386 are not supported.

## Features

- **Web Terminal**: Access Codex through a browser-based terminal
- **Config Access**: Read and write Home Assistant configuration files
- **hass-mcp Integration**: Direct control of HA entities and services
- **Session Persistence**: Optional tmux integration to preserve sessions across page refreshes
- **Customizable Theme**: Choose between dark and light terminal themes
- **Usage Sensors**: Codex's own 5-hour and weekly rate limits, published to Home Assistant over MQTT
- **Secure Authentication**: Codex handles its own sign-in; no API key in the add-on config

## Setup

### 1. Install the Add-on

1. Add the repository to Home Assistant
2. Install the "Codex" add-on
3. Start the add-on
4. Open the Web UI from the sidebar

### 2. Sign in

There is no browser inside the add-on, so use the device-code flow:

```bash
codex login --device-auth
```

Open the printed link, sign in, and enter the one-time code. To use an API key
instead:

```bash
printenv OPENAI_API_KEY | codex login --with-api-key
```

Credentials land in `/homeassistant/.codex/auth.json` and survive add-on
restarts, rebuilds and reinstalls. Treat that file like a password - it is part
of your Home Assistant backups.

## Configuration

| Where | What it holds |
|-------|---------------|
| `/etc/codex/config.toml` | Generated from the add-on options on every start. Lowest-precedence layer, inside the container, never in a backup |
| `/homeassistant/.codex/config.toml` | Yours. Overrides everything above, and the add-on never writes it |
| `/homeassistant/.codex/AGENTS.md` | Add-on instructions about HA paths and logs, refreshed on start while you have not edited it |
| `/homeassistant/.codex/AGENTS.override.md` | Your standing instructions. Codex prefers this over `AGENTS.md` |

So changing an add-on option always takes effect, and anything you set by hand
always wins over it.

### Sandbox mode

Codex normally isolates the commands it runs with bubblewrap, which has to
create a user namespace. Home Assistant add-on containers are usually not
allowed to do that, and Codex panics as soon as it runs a command. The default
`sandbox_mode` is therefore `danger-full-access`, which turns Codex's own
sandbox off and leaves the add-on container as the boundary - the same boundary
every other add-on runs behind. Keep `approval_policy` at `on-request` or
`untrusted` so Codex still asks before it acts.

If you pick `read-only` or `workspace-write`, the startup log tells you whether
it actually works on your system.

## Home Assistant Integration

The `homeassistant` MCP server ([hass-mcp](https://pypi.org/project/hass-mcp/))
is registered automatically and talks to Supervisor over the add-on's own token.

Codex gives an MCP server only a fixed allowlist of environment variables -
`HOME`, `PATH`, `SHELL`, `USER`, `LANG` and a few more - so the generated config
names the two extra ones to forward:

```toml
[mcp_servers.homeassistant]
command = "hass-mcp"
env_vars = ["HA_URL", "HA_TOKEN"]
```

`env_vars` forwards the values from the running process, so the Supervisor token
is never written to a file. An `env` table would work too, but it would put the
live token into the config on disk.

```bash
codex mcp list       # what is registered
ha core check        # validate configuration before restarting
ha core restart
```

## Usage Sensors

The add-on can publish how much of your Codex rate limit you have used to Home
Assistant, so a dashboard can show it and an automation can warn you before you
run out. It is on by default and needs no configuration: it reads the account
you are already signed in to here, and gets the broker details from the
Supervisor.

Requirements: an MQTT broker - the
[Mosquitto broker](https://github.com/home-assistant/addons/tree/master/mosquitto)
add-on is the usual one - and a `codex login` sign-in. An API-key sign-in has no
ChatGPT account behind it and cannot report usage. The startup log says which of
these is missing.

The sensors arrive by MQTT discovery on a device called **Codex Usage**:

| Entity | Example |
|--------|---------|
| `sensor.codex_usage_5h_used` | `49.4 %` |
| `sensor.codex_usage_5h_remaining` | `50.6 %` |
| `sensor.codex_usage_5h_reset` | timestamp |
| `sensor.codex_usage_weekly_used` | `8 %` |
| `sensor.codex_usage_weekly_remaining` | `92 %` |
| `sensor.codex_usage_weekly_reset` | timestamp |
| `sensor.codex_usage_credits` | `0` |
| `sensor.codex_usage_plan` | `plus` |
| `sensor.codex_usage_limit_status` | `ok` |

Which window is which is decided by the length the endpoint reports for it, not
by the order it lists them in - those two do not correspond. A window the
endpoint does not return at all makes its own sensors `unavailable`, rather
than leaving the last figure they saw on display: with no recent activity it
often reports only the weekly one, and the five-hour sensors come back once
there is five-hour usage to report.

The two reset sensors are `timestamp` entities holding an absolute time, not
preformatted text, so Home Assistant renders them in your own timezone and
`as_timestamp()` works in templates. The `limit status` sensor carries the whole
snapshot - window lengths, credit flags, capture time - in its attributes.

A gauge and a countdown to the next reset:

```yaml
type: gauge
entity: sensor.codex_usage_5h_used
name: Codex 5h
min: 0
max: 100
severity: { green: 0, yellow: 70, red: 90 }
```

```yaml
type: entities
entities:
  - entity: sensor.codex_usage_5h_reset
    name: Resets in
    format: relative
```

### What it does to your sign-in: nothing

The bridge only ever reads `auth.json`. Refreshing an OAuth token rotates the
refresh token, so a background refresh would invalidate the one the CLI in the
terminal is holding and could drop you back at a sign-in prompt. Instead, an
expired token makes the sensors unavailable and says so in the log - use Codex
in the terminal once and the CLI refreshes it itself.

Nothing about your account leaves the add-on beyond the usage request itself:
the published payload carries percentages, reset times, plan and credits, and no
tokens.

Turn `usage_sensors` off to stop publishing. The entities stay in Home Assistant
until you delete the `Codex Usage` device.

## Updating Codex

With `auto_update_codex` enabled the add-on installs the newest Codex release on
every start. It checks the published SHA-256 and then runs the new binary once,
and only replaces the working install if both pass - a release that cannot run
on your machine leaves the current one untouched and logs a warning. Turn the
option off to stay on whatever the image was built with.

## Credits

Derived from the [Claude Code add-on](https://github.com/robsonfelix/robsonfelix-hass-addons/tree/main/claudecode)
by Robson Felix (MIT). The container layout, ttyd terminal, hass-mcp wiring and
AppArmor profile come from that add-on; the Codex CLI, its config layering and
the sign-in flow are different.
