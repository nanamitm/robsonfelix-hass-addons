"""Idempotently replace matching events in a Home Assistant calendar."""

from __future__ import annotations

import asyncio
from datetime import datetime, time, timedelta
import logging
from typing import Any

import voluptuous as vol

from homeassistant.components.calendar import (
    CalendarEntity,
    CalendarEntityFeature,
    DATA_COMPONENT,
    EVENT_END,
    EVENT_START,
)
from homeassistant.const import CONF_DESCRIPTION, CONF_ENTITY_ID
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv
from homeassistant.util import dt as dt_util

DOMAIN = "calendar_event_sync"
SERVICE_REPLACE_EVENT = "replace_event"

CONF_SUMMARY = "summary"
CONF_START_DATE_TIME = "start_date_time"
CONF_END_DATE_TIME = "end_date_time"

_LOGGER = logging.getLogger(__name__)
_LOCK = asyncio.Lock()

SERVICE_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_ENTITY_ID): cv.entity_id,
        vol.Required(CONF_SUMMARY): cv.string,
        vol.Optional(CONF_DESCRIPTION, default=""): cv.string,
        vol.Required(CONF_START_DATE_TIME): cv.datetime,
        vol.Required(CONF_END_DATE_TIME): cv.datetime,
    }
)


async def async_setup(hass: HomeAssistant, config: dict[str, Any]) -> bool:
    """Register the calendar event replacement service."""

    async def async_replace_event(call: ServiceCall) -> None:
        entity_id: str = call.data[CONF_ENTITY_ID]
        summary: str = call.data[CONF_SUMMARY]
        description: str = call.data[CONF_DESCRIPTION]
        start: datetime = dt_util.as_local(call.data[CONF_START_DATE_TIME])
        end: datetime = dt_util.as_local(call.data[CONF_END_DATE_TIME])

        if end <= start:
            raise HomeAssistantError("end_date_time must be after start_date_time")

        component = hass.data.get(DATA_COMPONENT)
        entity = component.get_entity(entity_id) if component else None
        if not isinstance(entity, CalendarEntity):
            raise HomeAssistantError(f"Calendar entity not found: {entity_id}")

        required = CalendarEntityFeature.CREATE_EVENT | CalendarEntityFeature.DELETE_EVENT
        if not entity.supported_features or entity.supported_features & required != required:
            raise HomeAssistantError(
                f"Calendar does not support creating and deleting events: {entity_id}"
            )

        day_start = datetime.combine(start.date(), time.min, tzinfo=start.tzinfo)
        day_end = day_start + timedelta(days=1)

        async with _LOCK:
            events = await entity.async_get_events(hass, day_start, day_end)
            matching = [event for event in events if event.summary == summary and event.uid]

            for event in matching:
                await entity.async_delete_event(
                    event.uid,
                    recurrence_id=event.recurrence_id,
                )

            await entity.async_create_event(
                summary=summary,
                description=description,
                **{EVENT_START: start, EVENT_END: end},
            )

        _LOGGER.info(
            "Replaced %d matching event(s) in %s for %s",
            len(matching),
            entity_id,
            start.date(),
        )

    hass.services.async_register(
        DOMAIN,
        SERVICE_REPLACE_EVENT,
        async_replace_event,
        schema=SERVICE_SCHEMA,
    )
    return True
