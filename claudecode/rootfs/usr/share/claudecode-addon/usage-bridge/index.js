import { ApiLimiter } from "./rate-limit.js";
import { MqttClient } from "./mqtt.js";
import { discoveryMessages } from "./entities.js";
import {
  applyStatuslineState,
  fetchUsage,
  readStatuslineState,
  statuslineOnlyState,
} from "./usage.js";

const pollSeconds = Math.max(60, Number.parseInt(process.env.USAGE_POLL_SECONDS ?? "300", 10) || 300);
const apiMinIntervalMs = pollSeconds * 1000;
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
const apiRequestStatePath = process.env.CLAUDE_USAGE_REQUEST_STATE
  || `${config.claudeHome}/usage-api-last-request.json`;
const client = new MqttClient({ host: config.host, port: config.port, ssl: config.ssl,
  username: config.username, password: config.password, clientId: "ha-claude-usage",
  keepAlive: 60, will: { topic: config.availabilityTopic, payload: "offline", retain: true } });
const limiter = new ApiLimiter(apiRequestStatePath, apiMinIntervalMs);
let cachedState = null;
let polling = false;
let lastError = null;
let rateLimitLogged = false;
function availability(value) { client.publish(config.availabilityTopic, value, { retain: true }); }
async function poll() {
  if (polling) return;
  polling = true;
  try {
    const official = await readStatuslineState();
    if (!(await limiter.claim())) {
      if (!rateLimitLogged) {
        console.log(`[usage] API cooldown active; waiting for the persisted retry deadline`);
        rateLimitLogged = true;
      }
      if (official || cachedState) client.publish(config.stateTopic,
        JSON.stringify(cachedState ? applyStatuslineState(cachedState, official) : statuslineOnlyState(official)), { retain: true });
      availability(official || cachedState ? "online" : "offline");
      return;
    }
    rateLimitLogged = false;
    const state = await fetchUsage({ claudeHome: config.claudeHome, endpoint: config.endpoint });
    await limiter.success(state);
    cachedState = state;
    client.publish(config.stateTopic, JSON.stringify(applyStatuslineState(state, official)), { retain: true });
    availability("online");
    if (lastError) console.log("[usage] recovered; publishing usage again");
    lastError = null;
  } catch (error) {
    cachedState = null;
    limiter.state.api_error = true;
    if (error.status === 429) {
      try { await limiter.rateLimited(error.retryAfter); }
      catch (saveError) {
        console.error(`[usage] cannot persist API cooldown: ${saveError.message}`);
        availability("offline");
        process.exit(1);
        return;
      }
    }
    const official = await readStatuslineState();
    if (official) {
      client.publish(config.stateTopic, JSON.stringify(statuslineOnlyState(official)), { retain: true });
      availability("online");
      if (error.message !== lastError) console.log(`[usage] API unavailable; using fresh statusLine data: ${error.message}`);
    } else {
      availability("offline");
    }
    if (error.message !== lastError) console.log(`[usage] sensors unavailable: ${error.message}`);
    lastError = error.message;
  } finally {
    const diagnostics = limiter.diagnostics();
    if (lastError && diagnostics.api_status !== "rate_limited") diagnostics.api_status = "error";
    client.publish(`${baseTopic}/diagnostics`, JSON.stringify(diagnostics), { retain: true });
    polling = false;
  }
}
client.on("connect", () => {
  availability("offline");
  for (const message of discoveryMessages(config)) client.publish(message.topic, message.payload, { retain: true });
  console.log(`[usage] MQTT connected; polling every ${pollSeconds}s`);
  poll(); setInterval(poll, 30000);
});
client.on("error", (error) => { console.log(`[usage] MQTT error: ${error.message}`); process.exit(1); });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { availability("offline"); client.end(); process.exit(0); });
client.connect();
