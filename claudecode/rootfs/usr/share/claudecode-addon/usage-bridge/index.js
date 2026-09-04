import { MqttClient } from "./mqtt.js";
import { discoveryMessages } from "./entities.js";
import { fetchUsage } from "./usage.js";

const pollSeconds = Math.max(60, Number.parseInt(process.env.USAGE_POLL_SECONDS ?? "300", 10));
const baseTopic = process.env.MQTT_BASE_TOPIC || "claude/usage";
const config = {
  host: process.env.MQTT_HOST, port: Number(process.env.MQTT_PORT) || 1883,
  ssl: process.env.MQTT_SSL === "true", username: process.env.MQTT_USERNAME || undefined,
  password: process.env.MQTT_PASSWORD || undefined,
  claudeHome: process.env.CLAUDE_HOME || "/homeassistant/.claudecode",
  endpoint: process.env.CLAUDE_USAGE_ENDPOINT || undefined,
  discoveryPrefix: process.env.HA_DISCOVERY_PREFIX || "homeassistant",
  deviceId: "claude_usage", deviceName: "Claude Usage",
  claudeVersion: process.env.CLAUDE_VERSION || undefined,
  stateTopic: `${baseTopic}/state`, availabilityTopic: `${baseTopic}/availability`,
};
const client = new MqttClient({ host: config.host, port: config.port, ssl: config.ssl,
  username: config.username, password: config.password, clientId: "ha-claude-usage",
  keepAlive: 60, will: { topic: config.availabilityTopic, payload: "offline", retain: true } });
let polling = false;
let lastError = null;
function availability(value) { client.publish(config.availabilityTopic, value, { retain: true }); }
async function poll() {
  if (polling) return;
  polling = true;
  try {
    const state = await fetchUsage({ claudeHome: config.claudeHome, endpoint: config.endpoint });
    client.publish(config.stateTopic, JSON.stringify(state), { retain: true });
    availability("online");
    if (lastError) console.log("[usage] recovered; publishing usage again");
    lastError = null;
  } catch (error) {
    availability("offline");
    if (error.message !== lastError) console.log(`[usage] sensors unavailable: ${error.message}`);
    lastError = error.message;
  } finally { polling = false; }
}
client.on("connect", () => {
  availability("online");
  for (const message of discoveryMessages(config)) client.publish(message.topic, message.payload, { retain: true });
  console.log(`[usage] MQTT connected; polling every ${pollSeconds}s`);
  poll(); setInterval(poll, pollSeconds * 1000);
});
client.on("error", (error) => { console.log(`[usage] MQTT error: ${error.message}`); process.exit(1); });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { availability("offline"); client.end(); process.exit(0); });
client.connect();
