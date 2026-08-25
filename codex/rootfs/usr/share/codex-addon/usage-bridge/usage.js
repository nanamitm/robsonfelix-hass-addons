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
  const seconds = windowSeconds(window);

  return {
    used_percent: used === null ? null : Math.round(used * 10) / 10,
    remaining_percent:
      used === null ? null : Math.round((100 - used) * 10) / 10,
    window_minutes: seconds === null ? null : Math.round(seconds / 60),
    reset_at: resetTimestamp(window),
  };
}

function windowSeconds(window) {
  const seconds = asNumber(window.limit_window_seconds);
  if (seconds !== null && seconds > 0) return seconds;
  const minutes = asNumber(window.window_minutes);
  return minutes !== null && minutes > 0 ? minutes * 60 : null;
}

// Anything up to a day is the short window, anything longer is the long one.
// Codex's are five hours and a week, with nothing in between.
const SHORT_WINDOW_MAX_SECONDS = 24 * 60 * 60;

// The endpoint's own names do not say which limit is which. On a Plus account
// with no recent activity it returns the *weekly* window as `primary_window`
// and leaves `secondary_window` null, so trusting the names puts week-long
// figures on the five-hour sensors. The window's own stated length is the only
// thing that actually identifies it, so that is what is used - and a window
// that is simply absent stays absent rather than being filled with the other
// one's numbers.
function classifyWindows(payload) {
  const limits = payload?.rate_limit ?? payload?.rateLimits ?? {};
  const extra = Array.isArray(payload?.additional_rate_limits)
    ? payload.additional_rate_limits
    : [];

  const candidates = [
    limits.primary_window,
    limits.primary,
    limits.secondary_window,
    limits.secondary,
    // Entries here have appeared both as windows and as wrappers around one.
    ...extra.flatMap((entry) => [entry, entry?.window, entry?.rate_limit]),
  ].filter(
    (window) =>
      window &&
      typeof window === "object" &&
      asNumber(window.used_percent) !== null,
  );

  let short = null;
  let long = null;

  const measured = candidates
    .filter((window) => windowSeconds(window) !== null)
    .sort((a, b) => windowSeconds(a) - windowSeconds(b));

  for (const window of measured) {
    if (windowSeconds(window) <= SHORT_WINDOW_MAX_SECONDS) short ??= window;
    else long ??= window;
  }

  // A window that does not say how long it is falls back to the order the
  // endpoint listed it in, which is the best guess left.
  for (const window of candidates) {
    if (windowSeconds(window) !== null) continue;
    if (!short) short = window;
    else if (!long) long = window;
  }

  return { short, long };
}

// `rate_limit_reached_type` is null in the normal case, so the booleans beside
// it are what actually say whether anything is throttled.
function limitStatus(payload) {
  const limits = payload?.rate_limit ?? payload?.rateLimits ?? {};
  const reached = firstOf(
    payload?.rate_limit_reached_type?.kind,
    payload?.rate_limit_reached_type,
  );

  if (reached && String(reached).toLowerCase() !== "unknown") {
    return String(reached);
  }
  if (limits.limit_reached === true || limits.allowed === false) {
    return "limited";
  }
  return "ok";
}

export function toState(payload) {
  const { short, long } = classifyWindows(payload);
  const fiveHour = normalizeWindow(short);
  const weekly = normalizeWindow(long);
  const credits = payload?.credits ?? {};

  // Only usage is published. The endpoint also returns the account id, user id
  // and e-mail address, and none of them belong on an MQTT topic.
  return {
    captured_at: new Date().toISOString(),
    plan: firstOf(payload?.plan_type, payload?.planType),
    five_hour_used_percent: fiveHour.used_percent,
    five_hour_remaining_percent: fiveHour.remaining_percent,
    five_hour_window_minutes: fiveHour.window_minutes,
    five_hour_reset_at: fiveHour.reset_at,
    weekly_used_percent: weekly.used_percent,
    weekly_remaining_percent: weekly.remaining_percent,
    weekly_window_minutes: weekly.window_minutes,
    weekly_reset_at: weekly.reset_at,
    // The balance has been seen as both a number and a string.
    credits_balance: asNumber(credits.balance),
    credits_has_credits: Boolean(credits.has_credits),
    credits_unlimited: Boolean(credits.unlimited),
    limit_status: limitStatus(payload),
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
