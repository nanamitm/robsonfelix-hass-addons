import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyStatuslineState,
  readStatuslineState,
  stableTimestamp,
  toState,
} from "../rootfs/usr/share/claudecode-addon/usage-bridge/usage.js";
import { captureStatusline } from "../rootfs/usr/share/claudecode-addon/usage-bridge/statusline.js";

test("one-second reset jitter resolves to one stable minute", () => {
  assert.equal(stableTimestamp("2026-09-10T18:59:59.983Z"), "2026-09-10T19:00:00.000Z");
  assert.equal(stableTimestamp("2026-09-10T19:00:00.000Z"), "2026-09-10T19:00:00.000Z");
});

test("Claude usage payload is flattened without floating point noise", () => {
  const state = toState({
    five_hour: { utilization: 36, resets_at: "2026-09-04T09:09:59.983Z" },
    seven_day: { utilization: 7, resets_at: "2026-09-10T18:59:59.983Z" },
    spend: { enabled: true, percent: 8.450000000000001,
      used: { amount_minor: 338, exponent: 2 }, limit: { amount_minor: 4000, exponent: 2 } },
  }, "pro");
  assert.equal(state.session_reset_at, "2026-09-04T09:10:00.000Z");
  assert.equal(state.weekly_reset_at, "2026-09-10T19:00:00.000Z");
  assert.equal(state.extra_usage_percent, 8.5);
  assert.equal(state.extra_usage_used, 3.38);
});

test("statusline captures official weekly limits and overrides API estimates", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "claude-statusline-"));
  const statePath = path.join(directory, "limits.json");
  assert.equal(await captureStatusline(JSON.stringify({ rate_limits: {
    five_hour: { used_percentage: 12, resets_at: "2026-09-05T09:00:00Z" },
    seven_day: { used_percentage: 34, resets_at: "2026-09-10T19:00:00Z" },
  } }), statePath), true);
  const official = await readStatuslineState(statePath);
  assert.equal(official.weekly.used_percent, 34);
  assert.equal(official.weekly.reset_at, "2026-09-10T19:00:00.000Z");
  assert.equal(applyStatuslineState({ weekly_used_percent: 7 }, official).weekly_used_percent, 34);
});
