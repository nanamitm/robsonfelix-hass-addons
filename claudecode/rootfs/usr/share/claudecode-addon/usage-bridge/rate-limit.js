import fs from "node:fs/promises";

// One bridge process owns this file. Persist before sending any request so
// MQTT reconnects and add-on restarts cannot bypass the cooldown.
export class ApiLimiter {
  constructor(file, intervalMs, now = Date.now) {
    this.file = file;
    this.intervalMs = Number.isFinite(intervalMs) ? Math.max(60000, intervalMs) : 300000;
    this.now = now;
    this.state = {};
  }
  async save() {
    const temporary = `${this.file}.tmp-${process.pid}`;
    await fs.writeFile(temporary, `${JSON.stringify(this.state)}\n`, { mode: 0o600 });
    await fs.rename(temporary, this.file);
  }
  async claim() {
    try { this.state = JSON.parse(await fs.readFile(this.file, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; this.state = {}; }
    if (!this.state || typeof this.state !== "object" || Array.isArray(this.state)) {
      this.state = {};
      throw new Error("Invalid API limiter state");
    }
    const deadline = Math.max(
      Number(this.state.requested_at || 0) + this.intervalMs,
      Number(this.state.next_allowed_at || 0),
      Number(this.state.poll_at || 0),
    );
    if (!Number.isFinite(deadline)) throw new Error("Invalid API limiter deadline");
    if (this.now() < deadline) return false;
    this.state.requested_at = this.now();
    await this.save();
    return true;
  }
  async rateLimited(retryAfter) {
    const failures = Math.min(20, Number(this.state.failures || 0) + 1);
    // First 429 waits one hour; repeated 429s back off up to 24 hours.
    const backoff = Math.min(86400000, 3600000 * 2 ** (failures - 1));
    this.state.api_error = true;
    this.state.failures = failures;
    this.state.next_allowed_at = Math.max(
      this.now() + Math.max(this.intervalMs, backoff),
      retryAfterDeadline(retryAfter, this.now()),
    );
    await this.save();
  }
  diagnostics() {
    const deadline = Math.max(
      Number(this.state.requested_at || 0) + this.intervalMs,
      Number(this.state.next_allowed_at || 0), Number(this.state.poll_at || 0),
    );
    return {
      api_status: this.state.next_allowed_at > this.now() ? "rate_limited"
        : this.state.api_error ? "error" : deadline > this.now() ? "waiting" : "ready",
      next_request_at: Number.isFinite(deadline) ? new Date(Math.max(deadline, this.now())).toISOString() : null,
      polling_interval: Math.max(this.intervalMs, this.state.poll_interval || 0) / 1000,
    };
  }
  async success(usage) {
    // Compare usage values only; capture/reset timestamps must not prevent idle mode.
    const keys = ["session_used_percent", "weekly_used_percent", "sonnet_weekly_used_percent",
      "extra_usage_percent", "extra_usage_used"];
    const snapshot = JSON.stringify(keys.map(key => usage?.[key] ?? null));
    const unchanged = usage && keys.some(key => usage[key] != null)
      && snapshot === this.state.snapshot;
    this.state.idle_count = unchanged ? (this.state.idle_count || 0) + 1 : 0;
    this.state.snapshot = snapshot;
    this.state.poll_interval = this.state.idle_count >= 6
      ? Math.max(this.intervalMs, 600000) : this.intervalMs;
    this.state.poll_at = this.state.requested_at + this.state.poll_interval;
    this.state.api_error = false;
    this.state.failures = 0;
    this.state.next_allowed_at = 0;
    await this.save();
  }
}

export function retryAfterDeadline(value, now) {
  if (typeof value !== "string" || !value.trim()) return 0;
  if (/^\d+$/.test(value.trim())) {
    const deadline = now + Number(value) * 1000;
    return Number.isFinite(deadline) ? deadline : 0;
  }
  const deadline = Date.parse(value);
  return Number.isFinite(deadline) ? deadline : 0;
}
