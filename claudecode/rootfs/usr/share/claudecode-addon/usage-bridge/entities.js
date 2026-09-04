function template(key) { return `{{ value_json.${key} if value_json.${key} is not none else 'None' }}`; }
function available(key) { return `{{ 'online' if value_json.${key} is not none else 'offline' }}`; }

const SENSORS = [
  ["session_used_percent", "session_used", "Session Used", "%", "mdi:gauge", "measurement"],
  ["session_reset_at", "session_reset", "Session Reset", null, "mdi:timer-refresh", null, "timestamp"],
  ["weekly_used_percent", "weekly_used", "Weekly Used", "%", "mdi:gauge", "measurement"],
  ["weekly_reset_at", "weekly_reset", "Weekly Reset", null, "mdi:calendar-clock", null, "timestamp"],
  ["sonnet_weekly_used_percent", "sonnet_weekly_used", "Sonnet Weekly Used", "%", "mdi:gauge", "measurement"],
  ["sonnet_weekly_reset_at", "sonnet_weekly_reset", "Sonnet Weekly Reset", null, "mdi:calendar-clock", null, "timestamp"],
  ["extra_usage_percent", "extra_usage", "Extra Usage", "%", "mdi:credit-card", "measurement"],
  ["extra_usage_used", "extra_usage_used", "Extra Usage Used", "credits", "mdi:credit-card-outline", "measurement"],
  ["extra_usage_limit", "extra_usage_limit", "Extra Usage Limit", "credits", "mdi:credit-card-settings", "measurement"],
  ["plan", "plan", "Plan", null, "mdi:card-account-details-outline"],
  ["status", "status", "Status", null, "mdi:alert-circle-outline"],
];

export function discoveryMessages(config) {
  const device = { identifiers: [config.deviceId], name: config.deviceName,
    manufacturer: "Anthropic", model: "Claude Code",
    ...(config.claudeVersion ? { sw_version: config.claudeVersion } : {}) };
  return SENSORS.map(([key, id, name, unit, icon, stateClass, deviceClass]) => ({
    topic: `${config.discoveryPrefix}/sensor/${config.deviceId}/${id}/config`,
    payload: JSON.stringify({ name, has_entity_name: true,
      unique_id: `${config.deviceId}_${id}`, object_id: `${config.deviceId}_${id}`,
      state_topic: config.stateTopic, value_template: template(key),
      availability_mode: "all", availability: [
        { topic: config.availabilityTopic, payload_available: "online", payload_not_available: "offline" },
        { topic: config.stateTopic, value_template: available(key), payload_available: "online", payload_not_available: "offline" },
      ], ...(unit ? { unit_of_measurement: unit } : {}), ...(icon ? { icon } : {}),
      ...(stateClass ? { state_class: stateClass } : {}), ...(deviceClass ? { device_class: deviceClass } : {}),
      ...(id === "status" ? { json_attributes_topic: config.stateTopic, entity_category: "diagnostic" } : {}),
      ...(id === "plan" ? { entity_category: "diagnostic" } : {}), device }),
  }));
}
