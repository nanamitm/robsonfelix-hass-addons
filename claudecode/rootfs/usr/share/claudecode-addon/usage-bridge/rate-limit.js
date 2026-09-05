import fs from "node:fs/promises";

// One bridge process owns this file. Persist before sending any request so
// MQTT reconnects and add-on restarts cannot bypass the cooldown.
export class ApiLimiter {
  constructor(file, intervalMs, now = Date.now) {
    this.file = file;
    this.intervalMs = intervalMs;
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
    const deadline = Math.max(
      Number(this.state.requested_at || 0) + this.intervalMs,
      Number(this.state.next_allowed_at || 0),
    );
    if (this.now() < deadline) return false;
    this.state.requested_at = this.now();
    await this.save();
    return true;
  }
  async rateLimited(retryAfter) {
    const failures = Math.min(20, Number(this.state.failures || 0) + 1);
    // Exponential backoff starts at twice the polling interval, capped at
    // one hour. A longer server-requested wait always takes precedence.
    const backoff = Math.min(3600000, this.intervalMs * 2 ** failures);
    this.state.failures = failures;
    this.state.next_allowed_at = Math.max(
      this.now() + Math.max(this.intervalMs, backoff),
      retryAfterDeadline(retryAfter, this.now()),
    );
    await this.save();
  }
  async success() {
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
