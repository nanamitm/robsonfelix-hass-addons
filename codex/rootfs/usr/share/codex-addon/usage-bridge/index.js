// Publishes Codex usage limits to Home Assistant over MQTT.
//
// Runs beside the web terminal inside the add-on container, which is the whole
// reason it needs no configuration: the Codex CLI the user signs in to keeps
// its token in $CODEX_HOME, this process reads it there, and the broker details
// come from the Supervisor. Broker connection details arrive as environment
// variables from the entrypoint - nothing is read from or written to disk
// except the token, which is only ever read.
//
// The process exits on any MQTT failure and lets the entrypoint's supervisor
// loop restart it, so there is no reconnection logic to get wrong.
import { MqttClient } from "./mqtt.js";
import { discoveryMessages } from "./entities.js";
import { fetchUsage, UsageError } from "./usage.js";
import { AuthError } from "./auth.js";

const log = (message) => console.log(`[usage] ${message}`);

function loadConfig() {
  const host = process.env.MQTT_HOST;
  if (!host) throw new Error("MQTT_HOST is not set");

  const baseTopic = process.env.MQTT_BASE_TOPIC || "codex/usage";
  const deviceId = process.env.DEVICE_ID || "codex_usage";
  const pollSeconds = Number.parseInt(process.env.USAGE_POLL_SECONDS ?? "", 10);

  return {
    host,
    port: Number.parseInt(process.env.MQTT_PORT ?? "", 10) || 1883,
    ssl: process.env.MQTT_SSL === "true",
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    codexHome: process.env.CODEX_HOME || "/homeassistant/.codex",
    // The usage endpoint is not a documented API. An override means a moved
    // endpoint can be worked around by setting one variable, rather than
    // waiting for a new add-on image.
    usageEndpoint: process.env.CODEX_USAGE_ENDPOINT || undefined,
    codexVersion: process.env.CODEX_VERSION || undefined,
    discoveryPrefix: process.env.HA_DISCOVERY_PREFIX || "homeassistant",
    deviceId,
    deviceName: process.env.DEVICE_NAME || "Codex Usage",
    stateTopic: `${baseTopic}/state`,
    availabilityTopic: `${baseTopic}/availability`,
    pollSeconds: Number.isFinite(pollSeconds) && pollSeconds > 0 ? pollSeconds : 60,
  };
}

const config = loadConfig();

const client = new MqttClient({
  host: config.host,
  port: config.port,
  ssl: config.ssl,
  username: config.username,
  password: config.password,
  // The client id has to be stable so a restart replaces the old session
  // instead of accumulating ghosts on the broker.
  clientId: `ha-${config.deviceId}`,
  keepAlive: 60,
  // Set as the Last Will because the container is stopped with a SIGKILL to
  // everything that is not PID 1. Without it the sensors would keep showing the
  // last value they saw, indefinitely and with no sign the bridge had gone.
  will: {
    topic: config.availabilityTopic,
    payload: "offline",
    retain: true,
  },
});

let lastFailure = null;
let polling = false;

function setAvailable(available) {
  client.publish(config.availabilityTopic, available ? "online" : "offline", {
    retain: true,
  });
}

async function poll() {
  // A slow request must not overlap with the next tick: two in-flight polls
  // would publish out of order and could leave the older snapshot retained.
  if (polling) return;
  polling = true;

  try {
    const state = await fetchUsage({
      codexHome: config.codexHome,
      endpoint: config.usageEndpoint,
    });
    // Retained, so Home Assistant restores the sensors immediately after a
    // restart instead of waiting out a poll interval of unavailability.
    client.publish(config.stateTopic, JSON.stringify(state), { retain: true });
    setAvailable(true);

    if (lastFailure) {
      log("recovered; publishing usage again");
      lastFailure = null;
    }
  } catch (error) {
    setAvailable(false);

    // An unreachable endpoint or a token waiting on the CLI is a normal, often
    // long-lived state. Logging it once per distinct cause keeps the add-on log
    // readable instead of adding a line every poll interval.
    const expected = error instanceof AuthError || error instanceof UsageError;
    const message = expected ? error.message : (error.stack ?? error.message);
    if (message !== lastFailure) {
      log(`sensors unavailable: ${message}`);
      lastFailure = message;
    }
  } finally {
    polling = false;
  }
}

client.on("connect", () => {
  log(`connected to ${config.host}:${config.port}`);
  setAvailable(true);
  for (const { topic, payload } of discoveryMessages(config)) {
    client.publish(topic, payload, { retain: true });
  }
  log(`published discovery for ${config.deviceName}; polling every ${config.pollSeconds}s`);

  poll();
  setInterval(poll, config.pollSeconds * 1000);
});

client.on("error", (error) => {
  // Exit rather than reconnect: the entrypoint restarts this process on a
  // fixed delay, which handles a broker that is merely slow to come up as well
  // as one that has moved.
  log(`MQTT connection lost: ${error.message}`);
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    setAvailable(false);
    client.end();
    process.exit(0);
  });
}

client.connect();
