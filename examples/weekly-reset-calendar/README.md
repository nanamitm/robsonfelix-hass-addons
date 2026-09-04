# Keep weekly reset events in a local calendar

The Codex and Claude Code usage bridges expose their weekly reset as timestamp
sensors. This example keeps each reset in a Home Assistant Local Calendar
without accumulating duplicate events after a restart or a small timestamp
correction.

The included `calendar_event_sync.replace_event` action finds events on the
target local date with the same summary, deletes them, and creates exactly one
event using the sensor's current timestamp.

## Requirements

- Home Assistant 2026.9 or newer
- A Local Calendar with create and delete support
- `sensor.codex_usage_weekly_reset`, `sensor.claude_usage_weekly_reset`, or both

The Claude sensor is provided by the Claude Code add-on usage bridge. The Codex
sensor is provided by this repository's Codex add-on. Change the example entity
IDs if Home Assistant assigned different IDs.

## Install

1. Copy `custom_components/calendar_event_sync` from this example to
   `/config/custom_components/calendar_event_sync`. In the Home Assistant add-on
   terminal, `/config` is mounted as `/homeassistant`.
2. Add the following to `configuration.yaml`:

   ```yaml
   calendar_event_sync:
   ```

3. Create Local Calendars for Codex and Claude. The example expects
   `calendar.codex` and `calendar.claude`.
4. Copy the automations you need from `automations.yaml` into your Home
   Assistant automations. Adjust calendar entity IDs, summaries, descriptions,
   and durations as desired.
5. Check the configuration and restart Home Assistant:

   ```bash
   ha core check
   ha core restart
   ```

## Behavior

The automation also runs when a sensor recovers from `unavailable`. For the
target event's local date, the action removes every event whose summary exactly
matches the configured summary and then creates one replacement. Other events,
including events with a different summary, are untouched.

The action deliberately replaces rather than merely skipping a matching event.
That lets it correct a one-second boundary change that calendar views may render
as adjacent minutes. It also makes the result idempotent when Home Assistant or
an add-on restarts.

Only use this action with a calendar you control. It calls the Home Assistant
CalendarEntity create/delete APIs directly because Home Assistant 2026.9 does
not expose event deletion as a regular automation action.
