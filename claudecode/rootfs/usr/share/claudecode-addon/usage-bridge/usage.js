import fs from "node:fs/promises";
import { readClaudeAuth } from "./auth.js";

const DEFAULT_ENDPOINT = "https://api.anthropic.com/api/oauth/usage";
const REQUEST_TIMEOUT_MS = 20_000;
export class UsageError extends Error {}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function percent(value) {
  const parsed = number(value);
  return parsed === null ? null : Math.round(parsed * 10) / 10;
}

// Anthropic alternates between :59.999 and :00.000 for the same boundary.
// Minute normalization makes the MQTT timestamp stable across polls.
export function stableTimestamp(value) {
  if (!value) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  return new Date(Math.round(milliseconds / 60_000) * 60_000).toISOString();
}

function money(value) {
  if (!value || value.amount_minor == null) return null;
  return number(value.amount_minor) / 10 ** number(value.exponent ?? 2);
}

export function toState(raw, plan = null) {
  const session = raw.five_hour ?? {};
  const weekly = raw.seven_day ?? {};
  const sonnet = raw.seven_day_sonnet ?? {};
  const extra = raw.extra_usage ?? {};
  const spend = raw.spend ?? {};
  const extraEnabled = extra.is_enabled ?? spend.enabled ?? false;
  const extraUsed = extra.used_credits == null
    ? money(spend.used)
    : number(extra.used_credits) / 10 ** number(extra.decimal_places ?? 2);
  const extraLimit = extra.monthly_limit == null
    ? money(spend.limit)
    : number(extra.monthly_limit) / 10 ** number(extra.decimal_places ?? 2);

  return {
    captured_at: new Date().toISOString(),
    plan,
    session_used_percent: percent(session.utilization),
    session_reset_at: stableTimestamp(session.resets_at),
    weekly_used_percent: percent(weekly.utilization),
    weekly_reset_at: stableTimestamp(weekly.resets_at),
    sonnet_weekly_used_percent: percent(sonnet.utilization),
    sonnet_weekly_reset_at: stableTimestamp(sonnet.resets_at),
    extra_usage_enabled: Boolean(extraEnabled),
    extra_usage_percent: percent(extra.utilization ?? spend.percent),
    extra_usage_used: extraUsed,
    extra_usage_limit: extraLimit,
    status: "ok",
  };
}

function officialWindow(window) {
  if (!window || typeof window !== "object") return null;
  return { used_percent: number(window.used_percent), reset_at: stableTimestamp(window.reset_at) };
}

export async function readStatuslineState(
  filePath = process.env.CLAUDE_STATUSLINE_FILE
    || "/homeassistant/.claudecode/statusline-rate-limits.json",
  maxAgeMs = 15 * 60 * 1000,
) {
  try {
    const state = JSON.parse(await fs.readFile(filePath, "utf8"));
    const capturedAt = Date.parse(state.captured_at);
    if (!Number.isFinite(capturedAt) || Date.now() - capturedAt > maxAgeMs) return null;
    const session = officialWindow(state.session);
    const weekly = officialWindow(state.weekly);
    if (!session && !weekly) return null;
    return { captured_at: state.captured_at, session, weekly };
  } catch { return null; }
}

export function applyStatuslineState(state, official) {
  if (!official) return state;
  const result = { ...state, status_source: "statusline" };
  if (official.session?.used_percent !== null && official.session?.used_percent !== undefined) {
    result.session_used_percent = official.session.used_percent;
  }
  if (official.session?.reset_at) result.session_reset_at = official.session.reset_at;
  if (official.weekly?.used_percent !== null && official.weekly?.used_percent !== undefined) {
    result.weekly_used_percent = official.weekly.used_percent;
  }
  if (official.weekly?.reset_at) result.weekly_reset_at = official.weekly.reset_at;
  return result;
}

export function statuslineOnlyState(official) {
  return applyStatuslineState({
    captured_at: official.captured_at, plan: null,
    session_used_percent: null, session_reset_at: null,
    weekly_used_percent: null, weekly_reset_at: null,
    sonnet_weekly_used_percent: null, sonnet_weekly_reset_at: null,
    extra_usage_enabled: null, extra_usage_percent: null,
    extra_usage_used: null, extra_usage_limit: null, status: "ok",
  }, official);
}

export async function fetchUsage({ claudeHome, endpoint }) {
  const { accessToken, plan } = await readClaudeAuth(claudeHome);
  const url = endpoint || DEFAULT_ENDPOINT;
  let response;
  try {
    response = await fetch(url, { headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "anthropic-beta": "oauth-2025-04-20",
      "User-Agent": "claude-code-home-assistant-addon",
    }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    throw new UsageError(`could not reach ${url}: ${error.message}`);
  }
  if (response.status === 401 || response.status === 403) {
    throw new UsageError(`Claude token rejected (HTTP ${response.status}) - use Claude Code once to refresh it`);
  }
  if (response.status === 429) {
    const error = new UsageError("usage request failed: HTTP 429");
    error.status = 429;
    error.retryAfter = response.headers.get("retry-after");
    throw error;
  }
  if (!response.ok) throw new UsageError(`usage request failed: HTTP ${response.status}`);
  try { return toState(await response.json(), plan); }
  catch (error) { throw new UsageError(`usage response could not be parsed: ${error.message}`); }
}
