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
| `/homeassistant/.codex/AGENTS.md` | Add-on instructions about HA paths and logs, rewritten on every start |
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
The token is passed through the environment and never written to disk.

```bash
codex mcp list       # what is registered
ha core check        # validate configuration before restarting
ha core restart
```

## Updating Codex

With `auto_update_codex` enabled the add-on installs the newest Codex release on
every start, verifying the published SHA-256 before replacing the binary. Turn
it off to stay on whatever the image was built with.

## Credits

Derived from the [Claude Code add-on](https://github.com/robsonfelix/robsonfelix-hass-addons/tree/main/claudecode)
by Robson Felix (MIT). The container layout, ttyd terminal, hass-mcp wiring and
AppArmor profile come from that add-on; the Codex CLI, its config layering and
the sign-in flow are different.
