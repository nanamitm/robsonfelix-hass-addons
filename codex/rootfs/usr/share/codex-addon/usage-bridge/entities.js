// Home Assistant MQTT Discovery payloads for the usage sensors.

// A null field renders as an empty string, which the MQTT integration treats as
// "no update" and skips. Without this, `None` would reach Home Assistant as a
// literal state and a timestamp sensor would log an error on every poll. The
// `is not none` test rather than a `default` filter is what keeps a legitimate
// 0 percent from being blanked out.
function template(key) {
  return `{{ value_json.${key} if value_json.${key} is not none else '' }}`;
}

const SENSORS = [
  {
    key: "five_hour_used_percent",
    id: "5h_used",
    name: "5h Used",
    unit: "%",
    icon: "mdi:gauge",
    state_class: "measurement",
  },
  {
    key: "five_hour_remaining_percent",
    id: "5h_remaining",
    name: "5h Remaining",
    unit: "%",
    icon: "mdi:gauge-low",
    state_class: "measurement",
  },
  {
    key: "five_hour_reset_at",
    id: "5h_reset",
    name: "5h Reset",
    icon: "mdi:clock-outline",
    device_class: "timestamp",
  },
  {
    key: "weekly_used_percent",
    id: "weekly_used",
    name: "Weekly Used",
    unit: "%",
    icon: "mdi:gauge",
    state_class: "measurement",
  },
  {
    key: "weekly_remaining_percent",
    id: "weekly_remaining",
    name: "Weekly Remaining",
    unit: "%",
    icon: "mdi:gauge-low",
    state_class: "measurement",
  },
  {
    key: "weekly_reset_at",
    id: "weekly_reset",
    name: "Weekly Reset",
    icon: "mdi:calendar-clock",
    device_class: "timestamp",
  },
  {
    key: "credits_balance",
    id: "credits",
    name: "Credits",
    icon: "mdi:wallet-outline",
    state_class: "measurement",
  },
  {
    key: "limit_status",
    id: "limit_status",
    name: "Limit Status",
    icon: "mdi:alert-circle-outline",
    entity_category: "diagnostic",
  },
  {
    key: "plan",
    id: "plan",
    name: "Plan",
    icon: "mdi:card-account-details-outline",
    entity_category: "diagnostic",
    // The full snapshot rides along here - window lengths, credit flags, the
    // capture time - so everything the endpoint returned stays inspectable
    // without turning each field into its own entity.
    attributes: true,
  },
];

export function discoveryMessages(config) {
  const device = {
    identifiers: [config.deviceId],
    name: config.deviceName,
    manufacturer: "OpenAI",
    model: "Codex CLI",
    ...(config.codexVersion ? { sw_version: config.codexVersion } : {}),
  };

  return SENSORS.map((sensor) => ({
    topic: `${config.discoveryPrefix}/sensor/${config.deviceId}/${sensor.id}/config`,
    payload: JSON.stringify({
      name: sensor.name,
      // The device supplies the prefix, so the entity is named "Codex Usage 5h
      // Used" without repeating "Codex" in every sensor name.
      has_entity_name: true,
      unique_id: `${config.deviceId}_${sensor.id}`,
      object_id: `${config.deviceId}_${sensor.id}`,
      state_topic: config.stateTopic,
      value_template: template(sensor.key),
      availability_topic: config.availabilityTopic,
      payload_available: "online",
      payload_not_available: "offline",
      ...(sensor.unit ? { unit_of_measurement: sensor.unit } : {}),
      ...(sensor.icon ? { icon: sensor.icon } : {}),
      ...(sensor.device_class ? { device_class: sensor.device_class } : {}),
      ...(sensor.state_class ? { state_class: sensor.state_class } : {}),
      ...(sensor.entity_category
        ? { entity_category: sensor.entity_category }
        : {}),
      ...(sensor.attributes
        ? { json_attributes_topic: config.stateTopic }
        : {}),
      device,
    }),
  }));
}
