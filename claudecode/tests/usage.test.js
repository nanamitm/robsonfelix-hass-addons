import assert from "node:assert/strict";
import test from "node:test";
import { stableTimestamp, toState } from "../rootfs/usr/share/claudecode-addon/usage-bridge/usage.js";

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
