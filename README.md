# nanamitm's Home Assistant Add-ons

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Custom add-ons for Home Assistant.

## Add-ons

| Add-on | Description |
|--------|-------------|
| [Codex](codex/) | OpenAI Codex CLI in the sidebar, for automations, debugging, and smart home management |
| [Claude Code](claudecode/) | Anthropic Claude Code in the sidebar, with built-in MQTT usage and reset-time sensors |

## Installation

[![Add Repository](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fnanamitm%2Frobsonfelix-hass-addons)

Or manually: **Settings** → **Add-ons** → **Add-on Store** → **⋮** → **Repositories** → Add `https://github.com/nanamitm/robsonfelix-hass-addons`

## Examples

- [Keep Codex and Claude weekly reset events in a Local Calendar](examples/weekly-reset-calendar)

## About this fork

Forked from [robsonfelix/robsonfelix-hass-addons](https://github.com/robsonfelix/robsonfelix-hass-addons).
This fork provides the Codex add-on and an enhanced Claude Code add-on.

The Claude Code add-on includes subscription-usage sensors through MQTT
Discovery. It publishes session and weekly usage, reset times, Sonnet usage,
extra usage, plan, and bridge status directly from the add-on. A separate HACS
installation of
[`hass-claude-usage`](https://github.com/trickv/hass-claude-usage) is not
required. Reset timestamps are normalized to the nearest minute to prevent
Anthropic's one-second timestamp jitter from repeatedly triggering Home
Assistant automations.

Auto-Monocle and Playwright Browser are not carried here; install those from the
upstream repository. Their history remains in this repository's git log.

## License

MIT License
