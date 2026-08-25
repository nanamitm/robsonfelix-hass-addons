// Home Assistant MQTT Discovery payloads for the usage sensors.

// The `is not none` test rather than a `default` filter is what keeps a
// legitimate 0 percent from being blanked out.
//
// A null field renders as "None", the payload the MQTT integration reads as "no
// value". An empty string would do the same job but it is logged as `Invalid
// state message '' from 'codex/usage/state'` on every single poll, and a
// warning a minute for a state the add-on is deliberately reporting is noise in
// a log people read to find real problems. The entity is unavailable either way
// - `availabilityTemplate` below is what decides that.
function template(key) {
  return `{{ value_json.${key} if value_json.${key} is not none else 'None' }}`;
}

// Each sensor is available only while the endpoint is actually reporting its
// field. Skipping the update instead - which is what an empty state payload
// does - would leave the last value it ever saw on display indefinitely, and a
// stale percentage is indistinguishable from a current one. The endpoint really
// does drop a whole window: an account with no recent activity gets no
// five-hour window at all.
function availabilityTemplate(key) {
  return `{{ 'online' if value_json.${key} is not none else 'offline' }}`;
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
    // The full snapshot rides along here - window lengths, credit flags, the
    // capture time - so everything the endpoint returned stays inspectable
    // without turning each field into its own entity. This sensor carries it
    // because its value is computed rather than read, so it is never null and
    // never goes unavailable while the bridge is up.
    attributes: true,
  },
  {
    key: "plan",
    id: "plan",
    name: "Plan",
    icon: "mdi:card-account-details-outline",
    entity_category: "diagnostic",
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
      // Both conditions have to hold: the bridge is up, and this particular
      // field is present in the snapshot it published.
      availability_mode: "all",
      availability: [
        {
          topic: config.availabilityTopic,
          payload_available: "online",
          payload_not_available: "offline",
        },
        {
          topic: config.stateTopic,
          value_template: availabilityTemplate(sensor.key),
          payload_available: "online",
          payload_not_available: "offline",
        },
      ],
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
