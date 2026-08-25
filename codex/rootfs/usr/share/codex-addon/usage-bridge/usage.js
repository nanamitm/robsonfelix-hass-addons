// Fetches the Codex usage snapshot and flattens it into the JSON the sensors
// read.
//
// The state payload is deliberately flat. Home Assistant value templates walk
// it with `value_json.<key>`, and a nested object that comes back null - which
// any of these windows can - turns that walk into a template error, while a
// missing flat key is simply skipped.
import { readCodexAuth } from "./auth.js";

// Same endpoint the Codex CLI itself calls. It is not a documented public API,
// so shapes are read defensively and every field may be absent.
const DEFAULT_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
const REQUEST_TIMEOUT_MS = 20_000;

export class UsageError extends Error {}

function firstOf(...values) {
  return values.find((value) => value !== undefined && value !== null) ?? null;
}

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIso(epochSeconds) {
  const seconds = asNumber(epochSeconds);
  if (seconds === null || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Absolute reset times are preferred over relative ones. A relative value is
// re-anchored to "now" on every poll, so a timestamp derived from it would
// drift by up to one poll interval each time and Home Assistant would record a
// state change on every single update. Rounding to the minute keeps the derived
// timestamp still between polls.
function resetTimestamp(window) {
  const absolute = toIso(
    firstOf(window.reset_at, window.resets_at, window.reset_at_epoch),
  );
  if (absolute) return absolute;

  const relative = asNumber(
    firstOf(window.reset_after_seconds, window.resets_in_seconds),
  );
  if (relative === null || relative < 0) return null;

  const at = Date.now() + relative * 1000;
  return new Date(Math.round(at / 60_000) * 60_000).toISOString();
}

function normalizeWindow(window) {
  if (!window || typeof window !== "object") {
    return { used_percent: null, remaining_percent: null, window_minutes: null, reset_at: null };
  }

  const used = asNumber(window.used_percent);
  const windowSeconds = asNumber(window.limit_window_seconds);
  const minutes = asNumber(window.window_minutes);

  return {
    used_percent: used === null ? null : Math.round(used * 10) / 10,
    remaining_percent:
      used === null ? null : Math.round((100 - used) * 10) / 10,
    window_minutes:
      minutes ?? (windowSeconds === null ? null : Math.round(windowSeconds / 60)),
    reset_at: resetTimestamp(window),
  };
}

export function toState(payload) {
  const limits = payload?.rate_limit ?? payload?.rateLimits ?? {};
  const primary = normalizeWindow(
    firstOf(limits.primary_window, limits.primary),
  );
  const secondary = normalizeWindow(
    firstOf(limits.secondary_window, limits.secondary),
  );
  const credits = payload?.credits ?? {};

  // "unknown" is what the endpoint reports when nothing is throttled, which
  // reads as a fault in Home Assistant. Anything else is passed through as-is
  // so a new kind of limit is visible rather than swallowed.
  const reached = firstOf(
    payload?.rate_limit_reached_type?.kind,
    payload?.rate_limit_reached_type,
  );
  const limitStatus =
    !reached || String(reached).toLowerCase() === "unknown" ? "ok" : String(reached);

  return {
    captured_at: new Date().toISOString(),
    plan: firstOf(payload?.plan_type, payload?.planType),
    five_hour_used_percent: primary.used_percent,
    five_hour_remaining_percent: primary.remaining_percent,
    five_hour_window_minutes: primary.window_minutes,
    five_hour_reset_at: primary.reset_at,
    weekly_used_percent: secondary.used_percent,
    weekly_remaining_percent: secondary.remaining_percent,
    weekly_window_minutes: secondary.window_minutes,
    weekly_reset_at: secondary.reset_at,
    credits_balance: asNumber(credits.balance),
    credits_has_credits: Boolean(credits.has_credits),
    credits_unlimited: Boolean(credits.unlimited),
    limit_status: limitStatus,
  };
}

export async function fetchUsage({ codexHome, endpoint }) {
  const url = endpoint || DEFAULT_ENDPOINT;
  const { accessToken, accountId } = await readCodexAuth(codexHome);

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "User-Agent": "codex-home-assistant-addon",
  };
  if (accountId) headers["ChatGPT-Account-Id"] = accountId;

  let response;
  try {
    response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new UsageError(`could not reach ${url}: ${error.message}`);
  }

  if (response.status === 401 || response.status === 403) {
    throw new UsageError(
      `the Codex token was rejected (HTTP ${response.status}) - sign in again with 'codex login --device-auth'`,
    );
  }
  if (!response.ok) {
    throw new UsageError(`usage request failed: HTTP ${response.status}`);
  }

  try {
    return toState(await response.json());
  } catch (error) {
    throw new UsageError(`usage response could not be parsed: ${error.message}`);
  }
}
